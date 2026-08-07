# Performance & Large-Repo Scalability — Improvement Notes

_Honest summary: the indexing path has been genuinely engineered for scale (streamed zipball extraction, search + scanner in Web Workers, dynamic imports for heavy libs, a real tiered store design), but the memory-tiering has two holes that defeat its own stated OOM goals, one heavy AST workload is still on the main thread, and the LRU cache layer rewrites/loads full multi-MB repo blobs for trivial operations. Severity legend: **[HIGH]** real scale/UX failure on large repos · **[MEDIUM]** meaningful waste or risk · **[LOW]** bounded/edge-case._

## Overall assessment

The good is real and worth stating: `streamUnzipFiles` avoids buffering the whole zip; `search-worker-client` and `scanner-client` correctly move search and scanning off the main thread and send metadata-only to the worker for the IDB tier; `batchIndexFiles` does a single-pass build that avoids the O(n²) Map-copy that `indexFile` still has; and the tiering (InMemory → IDB → Lazy) with a `deviceMemory`-adaptive threshold shows genuine intent.

But the tiering does not deliver what it advertises. The "IDB tier" never reduces heap because `batchIndexFiles` always stores full content in the in-memory `files` Map regardless of tier — so the adaptive threshold that claims to "prevent OOM from holding large repos entirely in a JS Map" (`config/constants.ts:48-49`) does exactly that anyway. Worse, the auto-fired `analyzeCodebase` pass reaches through the LazyContentStore and sequentially force-downloads every file of a >250 MB repo, defeating the entire lazy tier at its first automatic consumer. AST/babel parsing is the one heavy workload still on the main thread. And the repo cache rewrites and full-loads multi-MB blobs for LRU bookkeeping. These are concrete, high-impact, and all verified in code.

## Findings

### [HIGH] `analyzeCodebase` force-downloads the entire lazy (>250 MB) repo file-by-file

- **Where:** `providers/repository-provider.tsx:501-510` (B5 effect); `lib/code/parser/analyzer.ts:21-32`; `lib/code/code-index.ts:50-54` (`getFileContent`); `lib/code/content-store.ts:302-317` (`LazyContentStore.get`); `lib/github/indexing-pipeline.ts:62-97`.
- **Problem:** For repos ≥ `LAZY_CONTENT_THRESHOLD_KB` (250 MB) the pipeline builds a metadata-only index (`content: ''`) backed by a `LazyContentStore`, `registerPaths()`-es every path into `metadataPaths`, and sets `indexingProgress.isComplete = true` immediately (`indexing-pipeline.ts:81,90-93`). The B5 effect fires unconditionally 50 ms later and calls `analyzeCodebase(codeIndex)`. Its phase-1 loop is `for (const [path] of codeIndex.files) { const content = await getFileContent(index, path) … }`. Because `file.content` is `''` (falsy), `getFileContent` falls through to `contentStore.get(path)`; `LazyContentStore.get()` sees the path in `metadataPaths` and calls `fetchQueue.enqueue(path, 'normal')`. The loop `await`s each file before the next, so it is a **serialized** download of the whole repo, one file at a time.
- **Impact:** Opening any 250 MB+ repo silently triggers a sequential download of every indexable file through the GitHub proxy — the exact opposite of the lazy tier's purpose. It exhausts GitHub rate limits, is extremely slow (serial, not even using the queue's concurrency of 10 because each iteration awaits), and re-persists everything to IDB. The lazy tier gives essentially zero protection because its first automatic consumer reads everything.
- **Recommendation:** Guard the B5 effect: skip `analyzeCodebase` when `codeIndex.contentStore instanceof LazyContentStore` (or gate on `contentAvailability === 'full'`). If analysis is wanted for lazy repos, make bulk analysis fetch-free — read only already-loaded content (`LazyContentStore.getBatch` is documented as *not* triggering fetches, `content-store.ts:323-326`) and skip un-loaded files, or add a read-only accessor that returns `null` instead of enqueuing.
- **Effort:** S · **Confidence:** high

### [HIGH] IDB content tier does not reduce heap — content always stays in the in-memory `files` Map

- **Where:** `lib/code/code-index.ts:224-239` (`batchIndexFiles`, esp. line 227); `lib/github/indexing-pipeline.ts:99,193,213-218`; `config/constants.ts:46-63` (`getIdbThresholdKB`).
- **Problem:** For the 50–250 MB "IDB tier", `indexing-pipeline` accumulates **all** file content into the `accumulated` array (`:99,193` / streamed at `:139`), fire-and-forget-writes it to `IDBContentStore` (`:142-144`), then calls `batchIndexFiles`, which unconditionally does `newFiles.set(path, { …, content, … })` (`code-index.ts:227`). Nothing ever removes content from the JS Map. So a 150 MB repo holds ~150 MB of source in the heap Map **and** an accumulated-array copy transiently **and** another copy in IndexedDB. The threshold's own comment claims it exists "to prevent OOM from holding large repos entirely in a JS Map" (`constants.ts:48-49`) — but the repo is still held entirely in the JS Map.
- **Impact:** The adaptive low-memory threshold (25 MB on ≤4 GB devices) provides no actual OOM protection for the IDB tier; it only adds IDB write cost and storage. On a low-memory device a 25–250 MB repo still risks the same OOM the threshold advertises against.
- **Recommendation:** Either (a) for the IDB tier stop populating `IndexedFile.content` in the `files` Map (store metadata only, route sync consumers through `contentStore` — the search/scan workers already read from IDB, so main-thread `searchIndex` is the remaining sync caller to migrate), which is the real fix; or (b) if that migration is too large, be honest in the comment/threshold that the IDB tier is a persistence cache, not a memory tier, and stop advertising OOM protection it does not provide.
- **Effort:** L · **Confidence:** high

### [HIGH] Whole-repo babel/AST parsing runs on the main thread, auto-triggered after indexing

- **Where:** `providers/repository-provider.tsx:501-510`; `lib/code/parser/analyzer.ts:16-68`.
- **Problem:** Search (`search-worker-client`) and the issue scanner (`scanner-client`) were both moved off-thread into Web Workers, but `analyzeCodebase` — which runs `extractImports`/`extractExports`/`extractTypes`/`extractClasses`/`extractJsxComponents` (babel `@babel/parser` per JS/TS file) plus graph + topology + circular-dep detection — runs on the main thread and is auto-fired for every repo by the B5 effect on index completion. Although the function is `async`, its phase-1 loop `await`s `getFileContent`, which for the in-memory/IDB tiers resolves synchronously (a pre-resolved Promise), so the loop drains as microtasks with no paint or interaction between files.
- **Impact:** For a repo with thousands of JS/TS files, opening it freezes the UI for seconds while every file is babel-parsed — jank exactly when the user expects the browser to become interactive after indexing "completes". The cost also recurs whenever `codeIndex` identity changes (edits, renames re-run the whole analysis; the B5 effect deps are `[codeIndex, indexingProgress.isComplete]`).
- **Recommendation:** Move `analyzeCodebase` into a Web Worker (a `FullAnalysis` serialization layer already exists in `scanner/serialization.ts`), or at minimum chunk the phase-1 loop and yield to the event loop between batches (`scheduler.yield()` / `setTimeout`), and skip re-analysis when only a few files changed (incremental analysis keyed off the edited paths, mirroring the scanner's `changedFiles` param).
- **Effort:** L · **Confidence:** high

### [HIGH] `getCachedRepo` rewrites the entire multi-MB repo record just to bump an LRU timestamp; `evictLRU`/`listCachedRepos` full-load every cached repo

- **Where:** `lib/cache/repo-cache.ts:118-123` (timestamp rewrite), `:69-96` (`evictLRU` `getAll`), `:192-220` (`listCachedRepos` `getAll`).
- **Problem:** On every cache hit, `getCachedRepo` reads the full `CachedRepo` (which embeds `files: Array<{path, content}>` for the whole repo — up to ~250 MB) and then does `store.put(entry)` **solely** to update `entry.timestamp` (`:119-123`). That serializes and rewrites the entire file-content blob to IndexedDB on each open. Separately, `evictLRU()` (`:73`) and `listCachedRepos()` (`:198`) both call `store.getAll()`, deserializing every cached repo's full contents into memory just to sort by timestamp / count files.
- **Impact:** Opening a cached large repo re-writes tens-to-hundreds of MB to disk for a timestamp change (write amplification, slow, flash wear, the readwrite tx can block other IDB work). `listCachedRepos()` on a "recent repos" UI loads all up-to-5 cached repos' full contents into memory at once — a multi-hundred-MB spike for what is meant to be a lightweight metadata list.
- **Recommendation:** Split LRU/metadata (`key, timestamp, sha, fileCount, description, stars, language`) into a small separate object store keyed by repo, and keep file contents in their own records. Bump the timestamp by writing only the metadata record. Use the metadata store (or a `key`-only cursor) for `evictLRU`/`listCachedRepos` instead of `getAll()` over full content.
- **Effort:** M · **Confidence:** high

### [MEDIUM] Large-repo content is persisted to IndexedDB twice (content store + repo cache)

- **Where:** `lib/github/indexing-pipeline.ts:142-144` (write to `IDBContentStore` during streaming) and `:228-232` (`setCachedRepo` writes the same `accumulated` array); `lib/code/content-store.ts:108` (`repolens-content` DB) vs `lib/cache/repo-cache.ts:6` (`repolens-cache` DB).
- **Problem:** For the IDB tier, every file is written to the `repolens-content` IDB database via `IDBContentStore.put` as it streams in, and then the entire `accumulated` array is written *again* to the separate `repolens-cache` database by `setCachedRepo`. The same repo content lives in two IndexedDB databases simultaneously.
- **Impact:** Doubles IndexedDB storage-quota consumption and disk-write volume for medium/large repos, making the browser's per-origin quota (and eviction) far more likely to bite on exactly the repos where quota matters. This finding was not in the original set; it compounds the write-amplification of the LRU finding above.
- **Recommendation:** Pick one persistence path per tier. For the IDB tier, either have the cache layer reference the already-written `IDBContentStore` records (store only metadata + a pointer in `repolens-cache`), or skip the `IDBContentStore` dual-write and let `repo-cache` be the single source of persisted content. Also add IndexedDB quota handling (`QuotaExceededError` is currently swallowed silently — `content-store.ts:206-208`, `repo-cache.ts:168-170`).
- **Effort:** M · **Confidence:** high

### [MEDIUM] `getFileLines` permanently caches a split line-array per file

- **Where:** `lib/code/code-index.ts:34-47`, used at `:329`/`:392` (search) and `lib/code/scanner/scanner.ts:9` (scanner).
- **Problem:** `getFileLines` lazily splits `file.content` into a `string[]` and stores it in a module-level `WeakMap` keyed by the `IndexedFile`. The cached array (one substring per line plus array overhead) is retained for the lifetime of the `IndexedFile`, and `invalidateLinesCache` is only called on explicit edits (`repository-provider.tsx:285`).
- **Impact:** After a search or scan touches most files, heap holds the original content strings **and** a full per-line array copy of each, roughly doubling the footprint over the touched files. Note (correction to the original review): search and scan run in Web Workers (`search-worker-client`, `scanner-client`), so this doubling happens mostly in the *worker* heap, which already holds a structured-clone copy of the index — not the main-thread heap. On the main thread only `getLineContext` and the SSR/test fallback `searchIndex` hit it. So the impact is real but concentrated in the worker, less severe than "doubling the main-thread footprint".
- **Recommendation:** Avoid materializing full line arrays for the whole repo: scan with a line-boundary index / regex over the raw string, or cap/evict the `WeakMap` (e.g. keep only the currently-viewed file), so the worker doesn't retain a second full copy of every visited file.
- **Effort:** M · **Confidence:** high

### [LOW] Search worker re-serializes and structured-clones the full in-memory repo on every index-identity change

- **Where:** `lib/code/search-worker-client.ts:40-61` (`ensureIndex`); `lib/code/scanner/serialization.ts` (`serializeCodeIndex`).
- **Problem:** `ensureIndex` detects a new `codeIndex` via `WeakRef`; for the **in-memory** tier it calls `serializeCodeIndex()` (a full `Array.from(index.files.entries())` copy including content) and `postMessage`s it, structured-cloning the whole payload across the worker boundary. Every edit/rename mints a new `codeIndex` identity, so the next search re-ships the whole repo.
- **Impact (corrected):** The original review estimated "~150 MB in-memory repo". That is not reachable on this tier: repos ≥ `getIdbThresholdKB()` (50 MB default, 25 MB on low-mem devices) use the IDB path, which sends **metadata only** (`search-worker-client.ts:45-51`). So the full structured clone is bounded to <50 MB (or <25 MB low-mem) — transiently ~2–3× that during the clone. Real but bounded; a GC hitch after an edit on a mid-size in-memory repo, not a 150 MB OOM.
- **Recommendation:** Either lower the "send full content" boundary to also route mid-size in-memory repos through the metadata-only path (worker reads from IDB), or send incremental deltas to the worker (changed paths only) instead of re-shipping the whole index on every identity change.
- **Effort:** M · **Confidence:** medium

### [LOW] `indexFile` is O(n) per call (full `totalLines` reduce + whole content-Map clone)

- **Where:** `lib/code/code-index.ts:128-167` (`indexFile`, reduce at `:163`, clone at `:151-153`); consumers e.g. `components/features/code/hooks/use-replace.ts:49`.
- **Problem:** `indexFile` recomputes `totalLines` via `Array.from(newFiles.values()).reduce(...)` over ALL files and, for the in-memory store, clones the entire content Map (`cloneContentStore` → `new Map(store)`) on every single call. `batchIndexFiles` avoids this, but single-file consumers (per-replace edits, per-file mini-index builds) pay full O(n) per edit → O(n²) across repeated edits.
- **Impact:** Bounded in practice (edits are occasional, mini-index builds are single-file), but on a large in-memory repo each single-file replace copies the whole content Map and re-sums every file's line count, causing a noticeable per-keystroke hitch on big repos.
- **Recommendation:** Maintain `totalLines` incrementally (add new `lineCount`, subtract the previous entry's) instead of re-reducing, and avoid cloning the full content Map for a single-key update (structural sharing or in-place mutation with a version stamp, as `batchIndexFiles` already does for IDB stores).
- **Effort:** M · **Confidence:** high

## Suggested order of work

1. **[HIGH · S] Gate the B5 `analyzeCodebase` effect off the lazy tier** (`repository-provider.tsx:501-510`) — one-line guard that stops a 250 MB repo from silently downloading itself. Highest impact-to-effort ratio.
2. **[HIGH · M] Fix the repo-cache LRU** (`repo-cache.ts`) — split metadata from content so opening/listing cached repos stops rewriting/loading hundred-MB blobs.
3. **[HIGH · L] Move `analyzeCodebase` into a worker (or chunk + yield)** and make it incremental on edits — kills the post-index main-thread freeze.
4. **[HIGH · L] Make the IDB tier actually save heap** (stop storing content in the `files` Map for that tier) — or, if deferring, correct the misleading OOM comment/threshold in `constants.ts` now.
5. **[MEDIUM · M] De-duplicate the double IDB persistence** and add `QuotaExceededError` handling.
6. **[MEDIUM · M] Cap/evict the `getFileLines` WeakMap** so the search/scan worker doesn't retain a second full copy of every visited file.
7. **[LOW] Incremental `totalLines` / delta search-worker updates** — polish once the above land.
