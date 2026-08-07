# Core Correctness & Edge Cases — Improvement Notes

_Honest review of the fetch → index → cache layer (github, parser, index, cache). One real high-severity data-loss bug, a cluster of mediums around a PAT/proxy behavioral fork and cache write amplification, and some low-severity footguns. Nothing critical. All 8 proposed findings survived independent verification; 0 dropped._

**Severity legend:** Critical = corrupts user data / crashes on common paths · High = wrong/incomplete output silently on realistic inputs · Medium = wrong behavior in a real but narrower scenario · Low = minor / latent / cosmetic.

## Overall assessment

The core layer is genuinely well-structured: the streaming zipball extractor (`zipball.ts`) is memory-conscious and guards zip-slip (`..`) and directory prefixes; the SWR memory cache and IndexedDB persistence are cleanly separated; error handling per-fetch is consistent and user-facing messages are reasonable. The weak spots are real, not stylistic. There is one clear correctness bug that silently truncates large repos (`RepoTree.truncated` is defined in the type but read nowhere in production), a behavioral divergence between the PAT-direct path and the OAuth-proxy path (fork metadata dropped in PAT mode), single-page fetches with no `Link` pagination for tags/branches/commits, and a per-cache-hit rewrite of the entire repo blob to IndexedDB just to bump a timestamp. The regex `typescript-parser.ts` is dead code (only self-referenced) and buggy, so it is a latent footgun rather than an active defect.

## Findings

### [HIGH] GitHub git-tree `truncated` flag is never checked — large repos silently lose files
- **Where:** `types/repository.ts:37` (`RepoTree.truncated` defined) · `lib/github/parser.ts:95-97` (`buildTreeApiUrl` → `recursive=1`) · `lib/github/fetcher.ts:69-90` (`fetchRepoTree`) · `providers/repository-provider.tsx:195-197` (consumes tree, never checks flag) · `lib/github/client.ts:96-102` (direct-mode tree mapping also passes data through untouched)
- **Problem:** The tree is fetched with `git/trees/{sha}?recursive=1`. GitHub caps that response (~100k entries / 7MB) and returns a partial tree with `truncated: true`. A repo-wide grep confirms `.truncated` on `RepoTree` is read in **zero** production files — only the type declaration and tests reference it. `buildFileTree` and `startIndexing` treat the partial tree as authoritative.
- **Impact:** For a large monorepo, the file browser shows an incomplete tree; the per-file fetch fallback (`indexing-pipeline.ts:178-206`) only iterates the truncated `indexableFiles`; and diagram/deps/compare features that walk `fileTree` operate on a silent subset. The truncated `fileTree` is then persisted via `setCachedRepo` (`indexing-pipeline.ts:228`) under the real tree SHA, so the incomplete view is cached and re-served as complete. Note: when the zipball path succeeds, the *indexed content* comes from the zip (all files), so the primary damage is the tree UI + the per-file fallback + everything keyed off `fileTree`.
- **Recommendation:** Read `tree.truncated` after `fetchTreeViaProxy`. When true, prefer the zipball file list as the source of truth for the tree, or fetch subtrees non-recursively per directory. At minimum, thread the flag into the provider state and render a visible "partial results" badge so downstream features don't present a subset as complete.
- **Effort:** M · **Confidence:** high

### [MEDIUM] `buildFileTree` silently drops any node whose parent directory is missing
- **Where:** `lib/github/fetcher.ts:512-519`
- **Problem:** When `parentPath !== ''`, the node is attached only if `nodeMap.get(parentPath)` exists and has `children`. If the parent entry is absent, the node is pushed neither to `root` nor to any parent — it vanishes with no error or counter. The sort at 485-491 guarantees parents-before-children for a *complete* tree (shallower depth first, `tree` before `blob`), so in normal operation this never fires. It fires exactly when the tree is truncated mid-directory (see finding above) or GitHub omits an intermediate tree entry.
- **Impact:** Under truncation the loss is not a clean tail cut — scattered files whose parent chain was severed disappear, making the incompleteness non-obvious and harder to detect. Compounds the truncation bug.
- **Recommendation:** On a missing parent, attach the node to `root` (or synthesize the missing directory chain from `parts`) instead of dropping it, and increment a dropped-node counter that can be logged/surfaced.
- **Effort:** S · **Confidence:** high

### [MEDIUM] PAT direct-mode repo normalizer drops `isFork`/`parentFullName`, diverging from the proxy path
- **Where:** `lib/github/client.ts:324-342` (`normalizeRepo`) and `244-260` (`GitHubApiRepoResponse` lacks `fork`/`parent`) vs `lib/github/fetcher.ts:45-63` (`fetchRepoMetadata` returns both) · `types/repository.ts:20-21`
- **Problem:** `fetchRepoMetadata` (OAuth proxy path) returns `isFork: data.fork ?? false` and `parentFullName: data.parent?.full_name ?? null`. `normalizeRepo` — used when a PAT is set and `proxyFetch` bypasses the proxy (`client.ts:535-541`) — omits both. Because the type marks them optional, this typechecks but yields `undefined` at runtime for PAT users. Confirmed these fields are consumed downstream (compare/fork detection: `components/features/compare/similarity-section.tsx`, `lib/compare/similarity-utils.ts`).
- **Impact:** PAT users and OAuth users get structurally different `GitHubRepo` objects from two paths that are meant to be interchangeable. Fork badges / "forked from …" info and any compare logic keyed on `isFork`/`parentFullName` silently behave differently in PAT mode only — an easy-to-miss fork between code paths.
- **Recommendation:** Add `fork` and `parent?: { full_name?: string }` to `GitHubApiRepoResponse` and set `isFork: data.fork ?? false`, `parentFullName: data.parent?.full_name ?? null` in `normalizeRepo`. Better: derive both normalizers from one shared mapper to prevent future drift (there are several such near-duplicate normalizers between `client.ts` and `fetcher.ts`).
- **Effort:** S · **Confidence:** high

### [MEDIUM] Tags/branches/commits fetch a single page — no `Link` pagination
- **Where:** `lib/github/fetcher.ts:150-175` (`fetchTags`), `200-223` (`fetchBranches`), `228-262` (`fetchCommits`) · `lib/github/client.ts:677-727` (proxy fetchers omit `per_page` unless caller passes it → GitHub defaults to 30) · `lib/github/client.ts:135-146` (direct-mode commits mapping copies `sha/since/until/per_page/path` but not `page`)
- **Problem:** None of these follow the `Link: rel=next` header; each returns one page. The server-side helpers default `perPage` to 100, but the client proxy fetchers (`fetchTagsViaProxy` etc.) only set `per_page` when the caller supplies it, so the effective default is GitHub's 30. Separately, the direct-mode commits URL mapper omits `page`, so even if a caller wanted to paginate in PAT mode it couldn't (currently no caller passes `page`, so this is latent).
- **Impact:** A repo with >100 (or >30, via the proxy default) tags/branches, or commit history beyond one page, receives a silently truncated dataset. Changelog generation can miss older tags; "all branches" isn't all; compare/git-history operate on a capped slice. Because it is capped rather than errored, the output looks complete.
- **Recommendation:** For the callers that need completeness (changelog tags, branch lists), add opt-in `Link`-header pagination with a sane cap. Pass `per_page=100` explicitly from the proxy fetchers. Include `page` in the direct-mode commits mapping so PAT and proxy modes stay identical.
- **Effort:** M · **Confidence:** high

### [MEDIUM] Every cache hit rewrites the entire repo record (all file contents) to IndexedDB to bump a timestamp
- **Where:** `lib/cache/repo-cache.ts:118-123` (`getCachedRepo` touch)
- **Problem:** On every `getCachedRepo`, the code mutates `entry.timestamp = Date.now()` and does `put(entry)` — writing back the whole `CachedRepo`, including the full `files` array (potentially tens of MB of source) — in a fire-and-forget transaction that is neither awaited nor error-guarded beyond the outer `try` (the `tx` is created and `put` called, but `tx.oncomplete`/`onerror` are never wired, and the promise resolves before the write finishes).
- **Impact:** Loading a cached medium/large repo triggers a multi-MB structured-clone + IndexedDB write purely to update one number, adding latency and disk churn on the hot cache-hit path (`repository-provider.tsx:203-218`). LRU freshness is paid for by rewriting all content. A failed or racing write is silent.
- **Recommendation:** Keep timestamps in a small separate metadata store/record keyed by repo key and update only that on touch, leaving the heavy `files` blob untouched. Or drop the touch entirely if approximate LRU (write-recency only) is acceptable — eviction already sorts by timestamp in `evictLRU`.
- **Effort:** M · **Confidence:** high

### [LOW] Zipball size limits compare UTF-16 string length against a byte budget
- **Where:** `lib/github/zipball.ts:112-116` (`totalSize += content.length`), cf. `94-98` (per-file `fileSize` correctly uses `data.length` bytes)
- **Problem:** Per-file accumulation uses decompressed `Uint8Array` `data.length` (bytes — correct). But the cumulative guard does `totalSize += content.length` where `content` is the `strFromU8` result, i.e. UTF-16 code-unit count, then compares to `MAX_TOTAL_EXTRACTED_SIZE` (200,000,000 "bytes"). For multibyte/non-ASCII content the two units diverge, so the 200MB cap does not correspond to actual extracted bytes.
- **Impact:** The cumulative cap trips at the wrong point (fine for ASCII where 1 char ≈ 1 byte, skewed otherwise). When it does trip mid-stream, `zipballUsed` is still set to `true` in the caller (`indexing-pipeline.ts:156`) and the repo is treated as fully indexed despite being cut off — no partial-extraction signal. Bounded impact: only very large repos near the cap.
- **Recommendation:** Track cumulative bytes from the raw `Uint8Array` lengths (before `strFromU8`) for the total-size guard. When the cap is hit, return/propagate a "partial extraction" flag so the caller doesn't report success.
- **Effort:** S · **Confidence:** medium

### [LOW] Memory cache: reads don't refresh LRU order, `invalidatePattern` over-matches sibling repos, stale comment
- **Where:** `lib/cache/memory-cache.ts:18` (`MAX_ENTRIES = 500`) vs `68` (comment says "MAX_ENTRIES=100") · `38-48` (`getCached` never reinserts) · `83-89` (`invalidatePattern` uses `startsWith`)
- **Problem:** Eviction is insertion/write-recency FIFO: `setCache` does delete-then-set (moving the key to the tail), but `getCached` never re-inserts, so a frequently-read-but-not-rewritten entry is evicted before an idle-but-recently-written one — it is not true LRU despite the naming. `invalidatePattern` matches by raw `startsWith`, so `invalidateRepoCache` invalidating `tree:foo/bar` (`client.ts:989-1005`) also nukes `tree:foo/bar-baz:*` — a real cross-repo collision for name-prefix siblings (e.g. `react` vs `react-native`). The `MAX_ENTRIES` comment (100) contradicts the value (500).
- **Impact:** Minor and self-healing: occasional premature eviction causing an extra refetch, and cross-repo invalidation between prefix-sharing repo names. Both transient.
- **Recommendation:** Reinsert on read for true LRU (or rename/document as FIFO). Delimit invalidation prefixes with a trailing separator (`tree:foo/bar:`). Fix the stale comment.
- **Effort:** S · **Confidence:** high (mechanism); the sibling-collision needs two prefix-sharing repos in cache to actually bite.

### [LOW] Dead regex TS parser is buggy (misses `import type`, re-exports; counts braces through strings)
- **Where:** `lib/parsers/typescript-parser.ts:36` (import regex) · `83-90` (export patterns) · `271-290` (`findBlockEnd`). A repo-wide grep for `parseTypeScriptFile` returns **only this file** — no caller, not even a test.
- **Problem:** Real bugs, currently dormant: the import regex requires `\w+`/`{...}`/`* as` immediately after `import\s+`, so `import type { X } from '...'` fails to match and the dependency is dropped entirely; `export … from` re-exports are not captured by any of the three patterns; and `findBlockEnd` (271-290) counts `{`/`}` inside strings, template literals, and comments, yielding wrong `endLine` values.
- **Impact:** None today (dead code). Latent footgun: if a future caller wires it in believing it is the AST parser, dependency graphs and symbol ranges will be silently wrong. It also duplicates maintenance weight against the real babel/tree-sitter path.
- **Recommendation:** Delete it (preferred — nothing references it). If kept, mark it clearly deprecated and route callers to the babel/tree-sitter extractors; at minimum fix `import type` and re-export handling.
- **Effort:** S · **Confidence:** high

## Suggested order of work

1. **[HIGH] Surface/handle `RepoTree.truncated`** — even just a provider flag + UI badge stops presenting partial large-repo results as complete. Biggest correctness win.
2. **[MEDIUM] Fix `buildFileTree` orphan-drop** — small change, and it directly reduces the damage from #1.
3. **[MEDIUM] Restore `isFork`/`parentFullName` in `normalizeRepo`** (and ideally unify the two repo mappers) — removes a silent PAT-vs-OAuth divergence.
4. **[MEDIUM] Stop rewriting the full repo blob on cache-hit touch** — move the timestamp to a lightweight record; hot-path latency + disk churn.
5. **[MEDIUM] Add `Link` pagination (or explicit `per_page=100`) for tags/branches/commits** where completeness matters; add `page` to direct-mode commits mapping.
6. **[LOW] Delete the dead `typescript-parser.ts`.**
7. **[LOW] Zipball total-size guard in bytes; signal partial extraction.**
8. **[LOW] Memory cache: true LRU on read, prefix-delimited invalidation, fix stale comment.**
