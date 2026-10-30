# Large refactors: options and recommendations

Decision brief for the five structural items left in the [improvement backlog](./README.md). Each section was verified against `master` at `69151e1` (2026-10-30) by reading the code, and measured where the numbers change the decision. Where this brief disagrees with an older finding, this brief reflects the current code.

Effort: **S** under a day, **M** 1-3 days, **L** about a week, **XL** more.

## Suggested order

**Scanner and analysis (refactors 1-2).** 1) The taint-tracker.ts and deps fixes this brief was measured alongside have landed (`fde62d9`). 2) Do refactor (2) Option A first. It is about 1-2 days, touches only scanner.ts, the barrel and scanner tests, and leaves one pipeline whose test suite then pins the orchestrator that consumes FullAnalysis. 3) Do refactor (1) Option B after that, or in parallel, since the files do not overlap: analyzer and provider first, then the Symbols tab, then the AI tools. HOW THEY INTERACT: the scanner consumes FullAnalysis (structural-scanner.ts:8-103, finalizeScan scanner.ts:1024-1041), so any analyzer change must keep FullAnalysis deep-equal. The golden-analysis characterization test protects both refactors. The provider publishes a new FullAnalysis identity on every edit, and code-browser.tsx:340-374 scans once when codeIndex changes and again when the analysis arrives. With the memo, the second analysis arrives in about 20-50 ms, which makes the client-side scan dedupe (adjacent fix under refactor 2) worth doing together. The issues-panel tab cache caches whichever scan finishes first, even one that ran without the analysis. A faster analysis (Option B) narrows that race; a worker (Option C) could widen it on small repos. Add an issues-panel test where the analysis arrives after the scan resolves before changing analysis latency. If Option C is ever chosen and hosted in the scanner worker, do it only after refactor (2), so there is a single scan entry point and an analyze-then-scan request can share one index transfer.

**Search overlay and GitHub layers (refactors 3-5).** 1. Start with (4) Option A, about 1 day. Its proxy-vs-direct parity suite and its pruning of dead direct-mode code are the characterization step that (5) also needs. Write (5)'s route-error contract table in the same pass; both stub fetch at the GitHub boundary and call the real routes.
2. Then (5) Option C, 2-3 days. Do the server part first (errors.ts, fetcher.ts, graphql.ts, the route helper and the 15 route catches), then the client part (proxyFetch, direct mode, use-git-history). It depends on step 1's suites and closes the error half of (4)'s divergence.
3. Then (4) Option B, 2-3 days. The shared mappers and URL builders reuse (5)'s errors.ts and shrink KNOWN_DIVERGENCES to the redirect policy. Only consider (4) Option C after the tree-route rate cost is fixed: the measured one tree per minute per IP is worth fixing independently.
4. (3) Option B, 2-3 days, does not depend on (4) or (5); it touches only components/features/preview/* and e2e. A second person can do it in parallel, or it can follow (5), since it is maintainability plus a performance fix rather than a correctness fix.

None of these touch app/api/deps/route.ts, which is already status-based and out of (5)'s scope.

## (1) Repo-wide work on the main thread: the analyzer.ts run after indexing (B5), the Symbols tab, and the AI tools findSymbol, analyzeImports, topology and generateTour

Status: done, Option B, with every output unchanged (golden-analysis and tool characterization tests pin them). analyzeCodebase yields after each 50-file batch and between the graph phases (lib/code/yield.ts: scheduler.yield, else a MessageChannel macrotask), takes { signal }, and keeps a phase-1 memo (WeakMap<IndexedFile>, reset when the indexed path set changes, missed when a record's inline content changes in place; only memo misses are resolved, so an IDB-tier edit reads one file). The B5 effect aborts the superseded run. The Symbols tab extracts in yielding batches and caches complete results per CodeIndex. findSymbol, analyzeImports and the topology/import-graph diagram resolve in yielding batches (findSymbol skips files that cannot contain the name); generateTour scores each candidate once. The AI tools still compute from source, not from FullAnalysis. Remaining single tasks: each graph phase (computeTopology about 11-60 ms at 5k files, load-dependent), generateTour (about 16-41 ms at 5k), and the issues-panel tab-cache race described under Suggested order, which a test now pins. The section below records the state before the change.

### Current state

Verified against master 69151e1. CORRECTIONS TO THE DOCS: (a) The analyzer does not use Babel. lib/code/parser/analyzer.ts:16-88 runs only regex extractors (languages/javascript.ts:6-8, extract-exports.ts:5-7, extract-types.ts:10-12,111,187). Babel is imported only by the scanner (scanner/ast-parser.ts:5, ast-analysis.ts:6, taint-tracker.ts:7), which runs in its worker. The HIGH item in performance-and-scale.md about 'babel @babel/parser per JS/TS file' is wrong: the real work is regex extraction at about 0.08-0.22 ms per file. (b) The doc says the phase-1 loop awaits getFileContent. That is stale: analyzer.ts:24 now iterates resolveFileContentBatches (code-index.ts:178-219) in 50-file batches. (c) FOLLOWUP_REPORT says there is no yield between batches. That is true only for the in-memory tier. With inline content, getBatch is never called (code-index.ts:193-196), so the for-await loop drains as microtasks and the whole analysis runs as one task. On the IDB tier, getBatch is an IndexedDB request (a macrotask), so that tier is already sliced. The in-memory tier covers repos whose GitHub size is below getIdbThresholdKB(): 50 MB, or 25 MB on devices with 4 GB or less (config/constants.ts:44-63, indexing-pipeline.ts:161). (d) The lazy-tier HIGH item is fixed by the gate at repository-provider.tsx:757. HOW THE ANALYSIS RUNS: the B5 effect (repository-provider.tsx:753-791) runs on setTimeout(50) and passes no AbortSignal. Cleanup only drops the result, so a superseded analysis still runs to completion. Its deps are [codeIndex, isComplete, isCurrentConnection], so every edit or rename creates a new codeIndex identity and re-runs the full analysis. ANALYSIS IS NEEDED RIGHT AWAY, so running it lazily or on demand would defer almost nothing: the default tab is 'repo' (preview-panel.tsx:101), and project-summary.tsx:450-456 needs the analysis to render; code-browser.tsx:340 does not start its scan until the analysis exists; diagram-viewer.tsx:161 and export-menu.tsx:56 also wait for it. OTHER REPO-WIDE MAIN-THREAD CONSUMERS (all verified): (1) The Symbols tab (global-search-overlay.tsx:472-520) calls resolveFileContents over every path (:483-484), which puts the whole IDB-tier repo into one Map, then runs a synchronous extractSymbols loop (:488-500). It re-runs on every switch to the tab: deps are [codeIndex, activeTab] with no memo. (2) client-tool-executor.ts findSymbol (:507-540) calls resolveFileContents (:521), then runs a loop over files x lines x 6 SYMBOL_PATTERNS. (3) analyzeImports resolves every other path (:736-737). (4) generateDiagram topology/import-graph (:878-885) and generateTour (:1096-1102) error out if any path is missing, so they always fail on the lazy tier. generateTour also sorts with a comparator that runs a full-content regex on every comparison (:1151-1155, :1030). (5) diagrams/generators/index.ts:75-76 re-runs a full analyzeCodebaseAsync on the main thread for every class diagram. (6) entry-points.ts:172 and :211 loop getFileContent per file. (7) ToolExecutorOptions.codebaseAnalysis (client-tool-executor.ts:31) is never passed by chat-sidebar.tsx:133-150, so the AI tools always recompute.

### Impact

MEASUREMENT METHOD: vitest (jsdom), Node 24.20, i9-13900HX. The corpus is the repo's own 744 TS/TSX files (5.3 MB) replicated under r1/, r2/ and so on: 2,000 files (14.2 MB, 395k lines) and 5,000 files (36.7 MB, 1.02M lines), loaded as an in-memory index via batchIndexFiles. 'Longest block' is the largest gap between setTimeout(0) heartbeats. Worker transfer costs are the median of 3 runs of v8.serialize/v8.deserialize on the exact worker payloads. Logs are in the scratchpad: scanacc/mtperf-out.txt and scanacc/mtxfer-out.txt. RESULTS AT 2,000 / 5,000 FILES (in-memory tier): (a) analyzeCodebase: 461-477 ms / 933-1003 ms as ONE uninterrupted task, with zero event-loop turns. Phase 1 (per-file extractors) dominates at 152-289 ms / 507-1115 ms. computeTopology takes 11 / 45 ms and detectCircularDeps 1 / 7 ms. (b) The same analysis on an IDB-like store (getBatch on a macrotask) takes 689 / 1804 ms wall, but the longest block is only 44 / 82 ms, with 40 / 100 turns. The IDB tier is therefore already jank-safe; the freeze is in-memory-tier only. (c) Symbols tab: 316 / 840 ms single task, re-paid every time the tab opens. (d) AI findSymbol: 330 / 1057 ms (miss) and 374 / 1164 ms (hit), single task. analyzeImports: 69 / 164 ms. Topology diagram: 29 / 129 ms. generateTour: 125 / 298 ms. User-facing hardware is typically 2-4x slower than this CPU, so a 2,000-file in-memory-tier repo freezes the UI for roughly 1-2 s right after indexing completes. Each edit repeats the cost, plus a wasted rescan (see refactor 2). CHEAP WINS MEASURED: (i) A WeakMap<IndexedFile> memo cuts phase 1 after an edit from 152 / 507 ms to 0.4 ms; identity of unedited files is preserved by indexFile. The remaining graph phases cost about 20-50 ms. (ii) A substring prefilter cuts findSymbol from 231 to 46 ms and from 596 to 53 ms. COST OF MOVING ANALYSIS TO A WORKER (main-thread residual): (i) Posting the index with content: serialize 17 / 32 ms (payload 23.6 / 61.8 MB). The IDB tier sends metadata only: 1-3 ms, 0.3-0.8 MB. (ii) Receiving FullAnalysis: deserialize 22 / 48 ms (4.9 / 12.6 MB), plus deserializeFullAnalysis 5-16 ms. Total about 45-95 ms per run, split over 2-3 tasks.

### Options

| Option | Effort | Approach | Risk |
| --- | --- | --- | --- |
| Slice and cancel | S | Keep the work on the main thread, but never run longer than one 50-file batch without yielding, and stop superseded runs. This changes only scheduling; outputs stay identical. | Total main-thread CPU is unchanged (about 0.5-1 s at 2k-5k files, but sliced). Phases 2-5 still run as one block, measured worst at 82 ms with 5k files. Edits still trigger a full re-analysis. If the yield helper uses setTimeout(0), browsers clamp it to 4 ms after 5 nested calls, adding about 160 / 400 ms of latency at 2k / 5k files. Use scheduler.yield or a MessageChannel macrotask instead. |
| Slice + incremental memo | M | Option A, plus making re-analysis incremental and fixing the derived consumers while keeping every output identical. Add a phase-1 memo (WeakMap<IndexedFile, FileAnalysis>) guarded by a fingerprint of the indexed path set, and resolve content only for memo misses so IDB-tier re-analysis reads only edited files. Add linear-time fixes in topology, cache Symbols results per codeIndex, precompute generateTour scores, and switch analyzeImports and topology to batched resolution. | Correctness of the memo depends on IndexedFile objects never changing their content in place. That holds for indexFile, batchIndexFiles and renameFiles (provider :586 creates new objects). The exception is repository-provider.tsx:446-448, which mutates existingFile.content on the lazy path. The lazy tier is excluded from analysis by the gate, so keep that gate, or add content length to the memo key. Import resolution depends on the set of indexed paths, so clear the memo whenever that set changes (an O(n) key compare, about 1 ms); a missed invalidation produces stale edges. The memo's memory is about the size of one FullAnalysis (4.9 / 12.6 MB serialized at 2k / 5k files) and is GC-tied to live IndexedFiles. Swapping topology to a Set and an index-pointer queue must keep entryPoints and hubs in the same order. |
| Dedicated analysis worker | L | Mirror scanner-client. Add lib/code/parser/analysis.worker.ts and analysis-client.ts exposing analyzeInWorker(codeIndex, { signal }). On the IDB tier, send serializeCodeIndexMeta + storeKey + session overlay and let the worker read IDB itself (the pattern in scanner.worker.ts:23-29). On the in-memory tier, send serializeCodeIndex. Return serializeFullAnalysis, which already exists in scanner/serialization.ts. Keep a per-path memo keyed by content hash inside the worker (hashing everything costs 70 / 158 ms, but off-thread). The fallback when Worker is unavailable is the sliced analyzer from Option A. | The main thread still pays about 45-95 ms per run in structured clone (measured above); about 60 ms of that is receiving the analysis even on the IDB tier. This adds a third worker and a third transient copy of in-memory-tier source (up to about 62 MB serialized at 5k files). It adds a new versioned message contract. Worker startup adds latency on small repos, which widens the issues-panel tab-cache race (see refactor 2). Three provider test files mock '@/lib/code/import-parser' and must mock the client instead. Option A is still required as the fallback. It does not help the Symbols tab or the AI tools unless they also move into the worker. |

#### Slice and cancel

Files: `lib/code/parser/analyzer.ts`, `providers/repository-provider.tsx`, `components/features/preview/global-search-overlay.tsx`, `lib/ai/client-tool-executor.ts`, `lib/code/yield.ts (new helper)`

Tests: Existing tests that pin current behaviour: lib/code/parser/__tests__/analyzer-async.test.ts (8 tests, including the lazy no-bulk-fetch case and inline-vs-store parity), topology/graph/extract-*/languages tests, providers/__tests__/repository-provider.test.tsx:213 (the lazy gate), the symbols-tab block in components/features/preview/__tests__/global-search-overlay.test.tsx (:889+; note it mocks extractSymbols), lib/ai/__tests__/client-tool-executor.test.ts findSymbol (:352-398), client-tool-executor-lazy.test.ts (:188-228), and tour-executor.test.ts. WRITE BEFORE REFACTORING: (a) a golden serializeFullAnalysis snapshot for a mixed TS/JS/Python/Go fixture with alias imports, re-exports and a cycle, asserted equal for an inline index, an IDB-like store, and batch sizes 1/50/100; (b) a findSymbol table test covering case-insensitive names, the kind filter, the 20-result cap and the partial-coverage warnings; (c) a Symbols-tab result-order test that uses the REAL extractSymbols. ADD AFTER: a yield-count spy test, and a provider test (fake timers) asserting that the previous analysis is aborted when codeIndex changes.

Steps:

1. Write the characterization tests (a)-(c).
2. Add yieldToEventLoop(): use scheduler.yield when available, otherwise a MessageChannel macrotask.
3. analyzer.ts: accept an options object { signal }, forward it to resolveFileContentBatches, and await the yield after each batch.
4. repository-provider.tsx B5: create an AbortController per effect run, abort it in cleanup, and ignore AbortError.
5. global-search-overlay.tsx Symbols tab: iterate resolveFileContentBatches with yields instead of resolveFileContents followed by one big loop.
6. client-tool-executor.ts findSymbol: iterate in batches with yields, and skip a file unless source.toLowerCase().includes(nameL).
7. Run the analyzer, provider, overlay and AI test suites, then pnpm typecheck.

#### Slice + incremental memo

Files: `lib/code/parser/analyzer.ts`, `lib/code/parser/topology.ts`, `providers/repository-provider.tsx`, `components/features/preview/global-search-overlay.tsx`, `lib/ai/client-tool-executor.ts`, `lib/code/yield.ts (new helper)`, `lib/diagrams/generators/index.ts (optional)`

Tests: Everything in Option A, plus these BEFORE refactoring: (1) re-analysis after an indexFile edit deep-equals a fresh analysis of the edited index; (2) after a renameFiles path-set change, it deep-equals a fresh analysis; (3) adding a file that makes a previously unresolved import resolve is reflected; (4) topology entryPoints and hubs keep their order under ties, pinned before the Set/queue change; (5) generateTour stop order with tied scores is pinned (Array.sort is stable, so precomputed scores must give the same order); (6) the Symbols cache is invalidated by a new codeIndex identity. Existing pins: topology.test.ts (9 tests), client-tool-executor-contentstore.test.ts generateTour inline-vs-stored parity, and tour-executor.test.ts.

Steps:

1. Do Option A steps 1-4.
2. Add the memo characterization tests (1)-(3), then add the phase-1 memo with the path-set fingerprint. Filter memo hits out of the paths passed to resolveFileContentBatches.
3. topology.ts: use a Set for orphans in place of orphans.includes (:24), and an index pointer in place of queue.shift() (:121), after pinning the ordering.
4. Symbols tab: add a WeakMap<CodeIndex, SymbolResult[]> cache, process in batches with yields, and keep the missing-path message.
5. AI tools: findSymbol prefilter with batching; compute generateTour's significanceScore once per candidate before sorting; switch analyzeImports and topology to resolveFileContentBatches (same outputs, and the whole IDB-tier repo is no longer held in one Map).
6. Optional: make generateDiagramAsync('classes') reuse the provider analysis when the repo has no non-JS/TS files.
7. Re-measure with the same corpus. Target: no block over about 50 ms, and an edit re-analysis costing at most the graph phases.

#### Dedicated analysis worker

Files: `lib/code/parser/analysis.worker.ts (new)`, `lib/code/parser/analysis-client.ts (new)`, `lib/code/scanner/serialization.ts (or move the FullAnalysis serializers to lib/code/parser/serialization.ts)`, `lib/code/parser/analyzer.ts`, `providers/repository-provider.tsx`, `providers/__tests__/repository-provider.test.tsx`, `providers/__tests__/repository-provider-session.test.tsx`, `providers/__tests__/repository-provider-pinning.test.tsx`

Tests: Use the scanner-worker.test.ts pattern for the worker (side-effect import of the worker entry, stubbed postMessage, fake-indexeddb for the IDB storeKey path). Use the scanner-client.test.ts pattern for the client (a FakeWorker; per-request cancel and AbortError; transfer of the session overlay). Add a parity test: analyzeInWorker equals analyzeCodebase on the golden fixture for in-memory and IDB stores. Also the Option A characterization tests.

Steps:

1. Do Option A first (the fallback needs it).
2. Move the FullAnalysis serializers to a neutral module.
3. Write the worker entry and the client with abort, IDB storeKey and overlay support.
4. Switch B5 to analyzeInWorker, keeping the lazy gate.
5. Add the worker-side content-hash memo.
6. Update the provider test mocks.
7. Re-measure: the main-thread residual should be about 45-95 ms in 2-3 tasks.

### Recommendation

Option B (Slice + incremental memo). The measurements undercut the docs' worker-first advice. The analyzer is cheap regex work, and the IDB tier is already sliced (longest block 44 / 82 ms). A worker would still leave about 45-95 ms of structured-clone work on the main thread per run, while adding a third worker, a new message contract and a third copy of the source. Option B removes every long task except the graph phases (about 15-80 ms). It turns edit re-analysis from a full pass (0.5-1 s) into about 20-50 ms. It fixes the Symbols tab and the AI-tool hotspots (findSymbol becomes 5-11x faster) with identical outputs. Revisit Option C only if real-device traces taken after B still show long tasks on the device class the owner targets.

### Decisions for the owner

- Which device class and which largest in-memory-tier repo (GitHub size up to 50 MB, roughly 2k-5k source files) must stay jank-free? If low-end phones or 4 GB laptops at about 5k files are first-class targets, plan Option C as a follow-up to B. Otherwise B is sufficient.
- For a later consolidation, may AI tool outputs change? Driving findSymbol, analyzeImports, the topology diagram and the generateTour ranking from the shared FullAnalysis, and passing ToolExecutorOptions.codebaseAnalysis, would remove 4-5 more whole-repo reads. But the analyzer's import resolution and extractors differ from the tools' own regexes, so results would change.

## (2) Twin scan pipelines: sync scanIssues versus async scanIssuesAsyncImpl in lib/code/scanner/scanner.ts

### Current state

Verified against the working tree. LOCATIONS (the doc line numbers 638-846 and 905-1134 are stale): scanIssues is scanner.ts:1086-1238, marked @deprecated core-only, and reports tree-sitter as 'skipped' at :1235. scanIssuesAsync is :1256-1304, and its implementation is :1306-1551. scanOnDemand is :1557-1571, also @deprecated, and wraps the sync path. mergeScanResults is :1581+. ALREADY SHARED (the doc is stale here): createScanAccumulator :880, addIssues :919, completeEngine and recordPartialEngine :928-962, deduplicateIssues :751, runRegexRules :326, runAstAnalysis :625, runTaintAnalysis :654, and finalizeScan :1013-1080, which covers the context cross-reference, sort, risk and grades. STILL DUPLICATED, about 150 lines: file selection (:1105-1119 vs :1325-1338), the extension precompute (:1123-1137 vs :1341-1343 and :1393-1403), and the engine sequence (:1146-1224 vs :1416-1496). CALLERS: the sync path has zero production callers (grep across app, components, providers, hooks and lib, excluding tests). All production scans go through scanIssuesAsync: the worker (scanner.worker.ts:32), the no-Worker fallback (scanner-client.ts:91-95), the AI scanIssues tool (client-tool-executor.ts:821-822), and code-browser, issues-panel and export-menu via scanInWorker. The barrel lib/code/scanner/index.ts:19 still re-exports scanIssues; its only consumer is real-repo-validation.test.ts:3. package.json is private with no exports, so this is not an external API. TEST CALLERS: 14 files, 119 lines calling scanIssues( and 22 calling scanOnDemand( (all in scanner-lazy.test.ts). mergeScanResults is used only in scanner-lazy.test.ts. These include the gating real-repo-validation.test.ts:271/346/372 (recall at least 80, avgFP at most 2). None of these files mocks tree-sitter. Equivalence tests already exist at scanner-async.test.ts:70, :406 and :435-494. DIVERGENCE, MEASURED (probe with the accuracy-sweep tree-sitter mock; log at scanacc/mttwin-out.txt): over all 224 accuracy fixtures, and over a 746-file corpus (repo TS plus package.json first and a lockfile last, so they fall in different 50-file batches) with and without FullAnalysis, both paths produce identical issue IDs, severity, confidence, description, cwe, line, column, riskScore, ruleOverflow, summary, grades and engine diagnostics. Only two differences appeared. (1) Tree-sitter runs only in the async path, by design. (2) rulesEvaluated differs when every file is excluded by SCANNER_EXCLUDE_PATTERNS: sync reports 53, async 21 (5 fixtures). Divergences that do not show up in findings: sync needs inline content, so on an IDB or lazy index it silently scans nothing (skip at :346). Sync throws on regex, composite, supply-chain or structural exceptions, while async records best-effort failures (runAsyncEngine :964-984). Sync partial scans still run the composite and supply-chain passes over the whole index: 152 ms versus 57 ms for 1 changed file in the 746-file corpus. Sync has no cancellation and no memo. Separately, the condition at :1335 is dead code because missingContentPaths is still empty at that point. Un-mocked tree-sitter under jsdom fails to initialise quickly (ENOENT, 124 ms the first time, 9 ms after) and is recorded as a best-effort failure with findings unchanged; strict mode throws. ADJACENT FINDINGS, VERIFIED: (a) The scan memo and the in-flight dedupe (scanner.ts:204-231, 1265-1303) are keyed on CodeIndex object identity. In production every request is deserialized fresh in scanner.worker.ts:23, so they can never hit. code-browser.tsx:353, issues-panel.tsx:194 and export-menu.tsx:60 each pay for a full worker scan, and code-browser scans twice per edit: once with the stale analysis and again when the new analysis arrives. (b) issues-panel.tsx:183-187 reuses tabCache('issues'), which is reset only on reconnect (repository-provider.tsx:181). After an edit, or when the analysis arrives after the first scan finished, the Issues tab keeps showing the earlier result. (c) clearScanCache() on sign-out or PAT removal (github-token-provider.tsx:100, user-menu.tsx:70) clears only the main-thread module state. The worker's AST cache (up to 500 parsed private-source ASTs) and the search worker's index survive; terminateScanWorker and terminateSearchWorker exist but are not called there. (d) Main-thread value imports of scanner.ts (github-token-provider.tsx:9, user-menu.tsx:9, and the issue-scanner barrel) put a 976 KB uncompressed chunk containing @babel/parser and the scanner into the first-load JS of /, /[owner]/[repo] and /compare. Total first-load JS is 2.81 MB per .next/diagnostics/route-bundle-stats.json from the 2026-10-30 00:38 build.

### Impact

End users see no difference today: findings are identical, and production uses only the async path. Developers carry the cost. About 150 lines of orchestration have to be edited in lockstep. The 141 legacy rule-test call sites exercise an orchestrator that production never runs: no 50-file batching, no deferred AST-eval capping, no lockfile augmentation, no best-effort diagnostics, no store-backed content. That includes the real-repo recall/FP gate. So regressions in the production orchestrator are caught only by scanner-async.test.ts, the accuracy sweep and real-world-validation. Sync and async run at the same speed on a full scan (746 files: 5.5-6.1 s sync vs 5.7-5.8 s async in-thread), so performance gives no reason to keep the sync path.

### Options

| Option | Effort | Approach | Risk |
| --- | --- | --- | --- |
| Delete sync path, migrate tests | M | Make scanIssuesAsync the only orchestrator. First land an equivalence characterization test, which passes today per the measurement above. Then move the 14 legacy test files to a small async helper and delete scanIssues and scanOnDemand from scanner.ts and the barrel. Keep or delete mergeScanResults according to the owner's decision below. | The churn is test-only, about 141 call lines. Migrated tests start running tree-sitter, which fails fast in jsdom and is recorded as a best-effort failure. Any test that asserts empty diagnostics.failures on non-JS files needs the shared tree-sitter mock, and strict mode would throw. The async memo (scanner.ts:1265-1275) can return a cached result when a test reuses an index; the helper calls clearScanCache first. forEach/map loops in real-repo-validation must become for...of loops. Production behaviour does not change. |
| Shared batch core, thin sync driver | M | Keep the deprecated API, but stop duplicating the orchestration. Extract the async loop body (scanner.ts:1367-1499) into scanContentBatch(state, batchFiles, runEngine), and file selection into selectFilesToScan. scanIssues then becomes a synchronous driver: it splits inline files into 50-file batches, uses a sync engine runner with the same best-effort semantics, then runs finalizeDeferredAstEvalIssues, the structural pass and finalizeScan, reporting tree-sitter as 'skipped'. | It keeps a production-unused API alive that still cannot run tree-sitter. Tree-sitter is the only async engine, so 'one core' still means two drivers. Sync behaviour shifts: engine exceptions stop throwing, and rulesEvaluated for excluded-only indexes changes from 53 to 21. The 141 legacy call sites still do not exercise async yields, cancellation or store-backed content. |
| Freeze and guard | S | Change no orchestration. Add the equivalence test to CI so any drift fails the build. Add an ESLint no-restricted-imports or no-restricted-syntax rule that forbids scanIssues and scanOnDemand outside *.test.ts. | Lowest churn. The duplication remains: every pipeline change still has to be made twice, or the guard fails. The legacy tests keep pinning the non-production orchestrator. |

#### Delete sync path, migrate tests

Files: `lib/code/scanner/scanner.ts`, `lib/code/scanner/index.ts`, `lib/code/scanner/scanner.test.ts`, `lib/code/scanner/scanner-integration.test.ts`, `lib/code/scanner/scanner-improvements.test.ts`, `lib/code/scanner/scanner-lazy.test.ts`, `lib/code/scanner/scanner-phase1-rules.test.ts`, `lib/code/scanner/scanner-phase2-5.test.ts`, `lib/code/scanner/scanner-vuln-detection.test.ts`, `lib/code/scanner/scanner-vuln-kl.test.ts`, `lib/code/scanner/scanner-vuln-mn.test.ts`, `lib/code/scanner/scanner-vuln-regression.test.ts`, `lib/code/scanner/new-security-rules.test.ts`, `lib/code/scanner/new-framework-quality-rules.test.ts`, `lib/code/scanner/__tests__/real-repo-validation.test.ts`, `lib/code/scanner/__tests__/scanner-async.test.ts`, `lib/code/scanner/__tests__/scan-equivalence.test.ts (new)`, `AGENTS.md`, `ARCHITECTURE.md`

Tests: Tests that pin behaviour and stay untouched: accuracy-sweep.test.ts (async, the authoritative gates), real-world-validation.test.ts (async), scanner-async.test.ts, scanner-worker.test.ts, scanner-client.test.ts, tree-sitter-scanner.test.ts, serialization.test.ts. WRITE BEFORE REFACTORING: scan-equivalence.test.ts. It runs both paths, with the accuracy-sweep tree-sitter mock, over every accuracy fixture and over a multi-file corpus: package.json first and the lockfile last; more than 15 non-security hits of one rule across batches; more than 15 eval hits across batches; an index whose files are all excluded; and an unparseable file. It asserts identical IDs and fields, ruleOverflow, summary, grades and engines other than tree-sitter, and records the known rulesEvaluated difference (53 vs 21) explicitly. Migrate each file only while this test is green; expectations should not change. AFTER DELETION: turn it into a batch-size-invariance test for the async path (batch sizes 1, 50 and 100 give equal results), using an internal batchSize option.

Steps:

1. Start from a tree that includes `fde62d9` (taint-tracker and deps fixes), since the scanner suites exercise taint tracking.
2. Add scan-equivalence.test.ts plus a shared tree-sitter mock and a scan() test helper (clearScanCache, then await scanIssuesAsync).
3. Migrate the 14 files one at a time: scanIssues(i, a, x) becomes await scan(i, a, x), with async callbacks; scanOnDemand(i, a, p) becomes await scanIssuesAsync(i, a, { changedFiles: [p] }). Run each file before moving on.
4. Delete scanIssues (:1086-1238) and scanOnDemand (:1557-1571), and remove scanIssues from index.ts:19. Apply the owner's decision on mergeScanResults.
5. Clean up: the stale comments at scanner.ts:5 and :206, and the dead condition at :1335.
6. Convert the equivalence test into the batch-size-invariance test.
7. Update the AGENTS.md and ARCHITECTURE.md scanner sections.
8. Run the full scanner suite, pnpm typecheck and pnpm lint.

#### Shared batch core, thin sync driver

Files: `lib/code/scanner/scanner.ts`, `lib/code/scanner/__tests__/scanner-async.test.ts`, `lib/code/scanner/__tests__/scan-equivalence.test.ts (new)`

Tests: Write the same scan-equivalence.test.ts first. All legacy suites stay unchanged and must keep passing. Add a test that an engine exception in the sync path is now recorded as 'failed', not thrown.

Steps:

1. Add scan-equivalence.test.ts.
2. Extract selectFilesToScan and scanContentBatch from the async implementation.
3. Rewrite scanIssues as the sync batch driver over the shared functions.
4. Run the full scanner suite and confirm the equivalence test still passes.

#### Freeze and guard

Files: `lib/code/scanner/__tests__/scan-equivalence.test.ts (new)`, `eslint.config.mjs`

Tests: The new equivalence test is the whole safety net. The existing suites are unchanged.

Steps:

1. Add scan-equivalence.test.ts.
2. Add the lint restriction.
3. Document in scanner.ts that new pipeline phases must go into both paths.

### Recommendation

Option A (delete the sync path and migrate the tests). The sync path has zero production callers and is not an external API (private package). The async path is authoritative: the accuracy gates and the worker use it. Findings were measured identical on 224 fixtures and a 746-file corpus, so the migration is mechanical with no expectation changes. Afterwards, the 141 legacy rule tests and the real-repo gate exercise the orchestrator production actually runs. Do the equivalence test first, since it is the guard for the migration. Also worth doing in the same window as small, separate changes (each S): move the scan memo and dedupe into scanner-client, keyed on (codeIndex, analysis, options), so code-browser, issues-panel and export-menu share one worker scan; invalidate tabCache('issues') when codeIndex or analysis changes; and terminate the scan and search workers on sign-out.

### Decisions for the owner

- scanOnDemand and mergeScanResults were built for incremental scanning on the lazy tier (a metadata-only base plus per-file scans merged in). Production has no lazy-tier scanning today: scanner-client.ts has no LazyContentStore branch. Is lazy-tier incremental scanning on the roadmap? If yes, keep mergeScanResults (pure and cheap) and rebuild on scanIssuesAsync({ changedFiles }). If no, delete both.

## (3) Decompose components/features/preview/global-search-overlay.tsx

### Current state

Re-measured on the current tree. The file is 1,182 lines and has 23 useState calls. The review doc's 1,064 lines and 19 useState are stale; FOLLOWUP_REPORT.md has the right numbers.

How the hooks are distributed:
- 22 useState are inside GlobalSearchOverlay, a 598-line function at :219-816 (render :624-815). The 23rd is in the local useDebouncedValue (:90-97).
- The main component also has 5 useEffect, 7 useMemo, 6 useCallback and 4 useRef.
- It calls queueMicrotask 5 times to move setState out of effects. This is required: eslint-config-next sets react-hooks/set-state-in-effect to error (checked with eslint --print-config), and the repo uses the pattern 41 times.
- ESLint today: 0 errors, 3 incompatible-library warnings.

The 22 states fall into five groups:
- Navigation/UI (4): activeTab, query, selectedIndex, collapsedFiles.
- Options (5): caseSensitive, wholeWord, useRegex, excludeGenerated, activeKinds.
- Files-tab rename (3): :240-243 and :312-326.
- Worker code search (7): :330-424. Its 7-setter reset block is copied three times (:343-351, :357-364, :402-407).
- Symbols (3): :468-520.

Seams that already exist in the file:
- Four prop-driven list components: FileResultsList :820-903, RenamePreviewList :905-950, CodeResultsList :952-1081, SymbolResultsList :1083-1182 (about 365 lines).
- TabButton, SearchToggle, HighlightedText :160-180 and FuzzyHighlight :184-207.

Duplicates elsewhere:
- useDebouncedValue is repeated in components/features/code/symbol-outline.tsx:126.
- HighlightedText has a twin in components/features/code/highlighted-text.tsx. The twin calls test() on each part, uses different styling and does not use the odd-index rule, so merging them is a behaviour change.
- The search effect parallels components/features/code/hooks/use-search.ts:46-116. The sidebar checks the regex and warns 'Unsafe/Invalid regular expression was searched as literal text.' (:66-77). The overlay falls back to literal search silently.

Tests:
- __tests__/global-search-overlay.test.tsx has 1,298 lines and 59 tests, and all pass.
- It mocks buildSearchRegex to always return null (:28, :69-72), so highlighting is never rendered and the never-throw literal-fallback contract is not pinned. The FOLLOWUP claim is confirmed; only lib/code/__tests__/search-partial.test.ts:248-266 pins it.
- It also mocks searchInWorker, extractSymbols, useVirtualizer and lucide-react. The lucide mock has no Replace, ArrowRight or Loader2, so rename mode cannot render.
- Not tested at all: the Files-tab rename flow (onRename is never passed), code-tab file-group collapse, and re-entering the Symbols tab.
- preview-panel.test.tsx mocks the whole overlay.
- There is no e2e test. e2e/trustworthy-analysis.spec.ts uses the code-tab search sidebar instead.

Latent bug: handleRenameAll (:317-326) has try/finally with no catch, and onClick={handleRenameAll} drops the promise. If onRename rejects, the result is an unhandled rejection and the user gets no feedback.

### Impact

Developers: a change to any one mode (Files, Code, Symbols, rename) means reading the 598-line function and its 22 states. The file has had 15 commits. Its tests replace the four real collaborators, so a regression in how the overlay drives the worker, the regex fallback, symbol extraction or the virtualizer would ship undetected.

Users (measured):
- Opening the Symbols tab runs a synchronous extraction loop over every file, about 22-26 ms per MB of source: 1k files/5.5 MB = 142 ms, 5k files/27.8 MB = 593 ms, 20k files/86 MB = 1,885 ms (medians of 3).
- This repeats on every entry to the Symbols tab (effect deps are [codeIndex, activeTab]) and every time the overlay is opened, because preview-panel.tsx:372 unmounts it on close.
- The symbol name filter costs 53-65 ms per debounced keystroke at 340k symbols and 35-183 ms at 1.04M symbols.
- Not hotspots: Files-tab fuzzy match takes 7 ms or less per keystroke at 20k paths, and rename preview 14 ms or less.
- Method: vitest probe (jsdom, Node 24.20, single thread) on synthetic TypeScript files with about 85 symbols per 200 lines. Real code has fewer symbols, but cost scales with bytes.

Users also get no feedback when a rename fails, and no warning when their regex is searched as literal text.

### Options

| Option | Effort | Approach | Risk |
| --- | --- | --- | --- |
| Move leaf modules only | S | Mechanical move with no change to state ownership. Put the list components, highlight helpers, controls, symbol-kind tables and types into sibling modules, and share useDebouncedValue with symbol-outline.tsx. The main file drops to about 600 lines; the 598-line function is untouched. | Very low. vi.mock works by module path, so existing mocks keep applying. The 22-state function and its coupling remain. |
| Characterize, then per-concern hooks | M | First write the tests that are missing, then move the leaf modules (Option A), then extract four hooks: - useOverlayCodeSearch: the 7 states become one state object, and the generation guard is kept. - useSymbolIndex: caches extracted symbols at module level in a WeakMap keyed by CodeIndex, checked against contentStore.contentRevision. This copies search-worker-client.ts:26,69. Re-entry and reopening become instant; only the first open pays. - useFileRename: adds a catch and an inline error state, fixing the unhandled rejection. - useListNavigation: selectedIndex, the clamp, and ArrowUp/ArrowDown/Enter. The component becomes a shell of about 250 lines. | Timing. The deferred resets, the debounced reset of the selection index and the generation guard must keep their current order. The hooks must keep the queueMicrotask pattern or lint fails. Cache staleness, if the key ignores in-place index mutation (FOLLOWUP notes loadFileContent mutates codeIndex without changing its identity). Keying on contentRevision handles content changes in the lazy store. The e2e smoke adds roughly 30 s to CI. |
| Reducer for UI state | M | Replace the navigation, option and rename-input states with a useReducer. TAB_CHANGED and QUERY_CHANGED would reset selection and collapse synchronously, which removes 2 microtask effects. The async results of worker search and symbols stay in effects. | Visible behaviour change: today selection resets on the debounced query (300 ms later on Code and Symbols); a reducer keyed on the raw query resets immediately. It centralizes state without separating concerns, and the 10 async states (more than half of the 22) are untouched. |

#### Move leaf modules only

Files: `components/features/preview/global-search-overlay.tsx`, `components/features/preview/global-search/result-lists.tsx (new)`, `components/features/preview/global-search/highlight.tsx (new)`, `components/features/preview/global-search/search-controls.tsx (new)`, `components/features/preview/global-search/symbol-kinds.ts (new)`, `hooks/use-debounced-value.ts (new)`, `components/features/code/symbol-outline.tsx`

Tests: The existing 59 overlay tests plus preview-panel.test.tsx must pass unchanged. No new tests are needed because the code only moves.

Steps:

1. Create components/features/preview/global-search/ and move the 4 list components, HighlightedText, FuzzyHighlight, TabButton, SearchToggle, the 3 symbol tables and the types.
2. Extract useDebouncedValue to hooks/use-debounced-value.ts and use it in symbol-outline.tsx as well.
3. Run vitest on the overlay and preview-panel tests, tsc and eslint.

#### Characterize, then per-concern hooks

Files: `components/features/preview/global-search-overlay.tsx`, `components/features/preview/global-search/* (new modules from Option A)`, `components/features/preview/global-search/use-overlay-code-search.ts (new)`, `components/features/preview/global-search/use-symbol-index.ts (new)`, `components/features/preview/global-search/use-file-rename.ts (new)`, `components/features/preview/global-search/use-list-navigation.ts (new)`, `components/features/preview/__tests__/global-search-overlay.test.tsx`, `components/features/preview/__tests__/global-search-overlay-rename.test.tsx (new)`, `components/features/preview/__tests__/global-search-highlight.test.tsx (new, real buildSearchRegex)`, `e2e/trustworthy-analysis.spec.ts`

Tests: Today the 59 unit tests pin tabs, debounce, generation guards, keyboard navigation, ARIA attributes and focus restore. search-partial.test.ts:248-266 pins the fallback in buildSearchRegex.

Write these before refactoring:
- Rename flow: add Replace, ArrowRight and Loader2 to the lucide mock. Pin that the toggle shows only on the Files tab with onRename; the from-to preview and conflict counts; Enter in the replacement input calling onRename then onClose; the disabled button; arrow keys doing nothing in replace mode; and the current behaviour on rejection.
- Code-tab collapse: selection skips collapsed matches, the index clamps, and collapse state resets when the query changes.
- A new file without the buildSearchRegex mock: unsafe '(a+)+$' and invalid 'foo(' with the regex toggle highlight the literal text and do not throw; whole-word and case-sensitive also work.
- Symbols: identical results after leaving and re-entering the tab. Count extractSymbols calls separately, since this count is meant to change.
- One Playwright smoke using connectFixture: open the overlay through 'Search repository files', then Files, Code (Ctrl+2) and Symbols (Ctrl+3), and Enter opens the code tab at the right line.

After refactoring, add unit tests for each hook with renderHook.

Steps:

1. Write the characterization tests and the e2e smoke against the current code, and commit them green.
2. Do Option A's module moves.
3. Extract useOverlayCodeSearch (single state object, same generation guard and abort handling) and run the tests.
4. Extract useSymbolIndex with the WeakMap+contentRevision cache, and update the one extractSymbols call-count expectation on purpose.
5. Extract useFileRename with catch and error state, and switch the rejection test to expect an inline error.
6. Extract useListNavigation and slim the component to a shell.
7. Run tsc, eslint, vitest and the e2e smoke.

#### Reducer for UI state

Files: `components/features/preview/global-search-overlay.tsx`, `components/features/preview/global-search/overlay-reducer.ts (new)`, `components/features/preview/__tests__/global-search-overlay.test.tsx`

Tests: The same characterization tests as Option B. Unit-test the reducer as pure transitions. Expect 'resets selection index when query changes' to need a deliberate update.

Steps:

1. Characterization tests as in Option B.
2. Define actions and the reducer, and replace the setters.
3. Drop the effects that reset selectedIndex and collapsedFiles.
4. Re-run the tests and review the timing differences.

### Recommendation

Option B, done in stages: Option A's mechanical moves are its second step. Skip Option C. The pain is concern-mixing and async state, which a reducer does not address, and it would change selection-reset timing. The characterization tests are the main value: they close the untested rename path and replace the four-mock-only coverage with one real e2e path. The symbol cache is a cheap, measurable win (repeat opens drop from about 0.6-1.9 s to near zero on 5k-20k-file repos). Moving symbol extraction into a worker is a separate performance item, not part of this refactor. Treat this as maintainability work, so schedule it after (5).

### Decisions for the owner

- Should the overlay's Code Search show the warning the code-tab sidebar shows (use-search.ts:73-77: 'Unsafe/Invalid regular expression was searched as literal text')? Today the overlay searches literally with no notice.
- Is caching symbols per repository content revision enough for now? The first Symbols open would still freeze for about 0.6 s at 5k files and 1.9 s at 20k. The alternative is moving extraction into the search worker as part of this work, about 2-3 more days.

## (4) Duplicated GitHub access: proxy routes + lib/github/fetcher.ts vs PAT direct mode in lib/github/client.ts

### Current state

When a PAT is set, these requests go straight from the browser to GitHub:
- Repo, tags, branches, commits (including file commits), compare and commit detail, via proxyFetch to mapProxyUrlToGitHubApi (client.ts:164-256, :689-707).
- Tree, through its own branch that reuses resolveRepoTree (client.ts:804-818).
- Blame, through direct GraphQL (client.ts:1040-1083). BLAME_QUERY is copied at :628-663; the original is fetcher.ts:368-403.

Dead direct-mode code:
- The 'tree' mapping (:176-182) is unreachable, because fetchTreeViaProxy calls proxyFetch only when there is no PAT.
- The 'file' mapping (:184-191) is computed and then skipped (:700), and directFetchRawFile (:368-387) has no callers.
- The 'rate-limit' mapping and normalizeRateLimit serve fetchRateLimitViaProxy, which has no production consumer. fetchLanguagesViaProxy, fetchRefsViaProxy and fetchPullRequestCommentsViaProxy have no production consumers either.

Direct-mode-only code is about 600 of client.ts's 1,249 lines. Its mapping logic duplicates fetcher.ts:99-117, 239-245, 280-284, 347-361 and 471-536.

With a PAT, these still go through the proxy, with the token in X-GitHub-Token (client.ts:128-134, lib/auth/token.ts:17-18): file, zipball, pulls, refs, languages and validate-token.

There is a third path that was not reported. components/features/code/hooks/use-downloads.ts:5,92,125,166 calls the server fetcher's fetchFileContent from the browser, unauthenticated, against raw.githubusercontent.com. When a file is not in the index, private-repo file downloads fail silently, and folder zips silently omit files.

Stale claims in the reports, now fixed:
- Link pagination: lib/github/pagination.ts collectGitHubPages is used by both paths (fetcher.ts:208-225, client.ts:307-317). Parity is pinned by lib/github/__tests__/client-pagination.test.ts.
- isFork/parentFullName (client.ts:495-496) now match fetcher.ts.
- The direct commits mapping now passes page (client.ts:221).
FOLLOWUP row 19 and the matching core-correctness items are therefore out of date.

Status: (5) closed every error divergence below and the null-repository blame case; both modes now throw the same GitHubError kind and message. mode-parity.test.ts KNOWN_DIVERGENCES lists only the redirect policy and the commit-detail stats default.

Remaining divergences, measured with a probe that sent each upstream response through both modes:
- 404: the proxy says 'Repository not found. Make sure the repository exists. If it's private, add a GitHub token in Settings.' Direct mode says 'Not Found'.
- 401: the proxy returns 500 'Failed to fetch repository/tags/...'. Direct mode says 'Invalid or expired GitHub token...'.
- 422 and 429: the proxy returns 500 with generic text (except compare, which returns 422). Direct mode shows GitHub's own text.
- 403 from SAML enforcement: the proxy says 'Rate limit exceeded...'. Direct mode shows GitHub's SAML text.
- Blame GraphQL NOT_FOUND, RATE_LIMITED and HTTP 403: the proxy returns 500 'Failed to fetch blame data'. Direct mode shows GitHub's text.

Further divergences found in the code:
- Direct mode has no deadline. The server has 30 s per request (fetchGitHub).
- Direct mode uses redirect:'error' (client.ts:331, :1046; deliberate since commit 9f58af3). The server follows redirects. So renamed or transferred repos, which GitHub answers with 301, fail only for PAT users.
- The rate-limit response has no authMethod and always reports authenticated:true.
- Commit detail: direct mode defaults a missing stats to zeros (:563), while the server throws a TypeError (fetcher.ts:476,494).
- Blame with a null repository is handled in direct mode (:1070) but throws a TypeError on the server (fetcher.ts:437).
- Owner/name/ref/per_page validation runs only on the proxy path.

Tests that pin today's behaviour:
- lib/github/client.test.ts:168-649: URL mapping, the raw GitHub error text at :478-505, normalization, and cache/credential scoping.
- client-pat.test.ts.
- client-pagination.test.ts: real route handlers plus a fake GitHub. This is the harness to generalize.
- e2e intercepts /api/github/** in the browser, so it exercises neither the server routes nor direct mode.

### Impact

PAT users and OAuth/anonymous users get different errors for the same failure. A PAT user who mistypes a repository sees 'Not Found'. OAuth users get a 500 with 'Failed to fetch …' for an expired token. PAT users cannot open renamed or transferred repositories. A hung GitHub request in PAT mode never times out.

Private-repo downloads drop files silently through the third path.

Maintainers keep about 600 lines of hand-mirrored URL building and normalization. They have drifted before: isFork was dropped in PAT mode until commit 98e7ecc.

Measured constraint on routing PAT traffic through the proxy: the real /api/github/tree route admitted 1 of 4 calls from one IP in one window (200, 429, 429, 429). The tree route costs 32 units (TREE_RESOLUTION_MAX_REQUESTS) of the default 60 per minute and never refunds. This already limits anonymous and OAuth users, for example on the compare page with a second repository, and it would start limiting PAT users. Commit detail admitted 60 of 80 calls.

Method: vitest probes calling the real route handlers through NextRequest, with getAccessToken mocked, applyRateLimit mocked or real as stated, and global fetch stubbed per upstream status.

### Options

| Option | Effort | Approach | Risk |
| --- | --- | --- | --- |
| Parity contract tests + prune | S | Keep both transports. Add a parity suite covering every live direct endpoint, delete the dead direct code, give direct mode the server's 30 s deadline, and route use-downloads through fetchFileViaProxy. | Low. Removing the rate-limit mapping changes fetchRateLimitViaProxy in PAT mode to go through the proxy, which adds authMethod:'pat'; it has no production consumer. The use-downloads change sends download traffic through /api/github/file, whose limit is 500 per minute. |
| Shared mappers + error constructor | M | Keep two transports (browser to GitHub with a PAT, server fetchGitHub otherwise) but one data contract: - lib/github/mappers.ts holds the raw GitHub response types, mapRepo/Tag/Branch/Commit/Compare/CommitDetail/PullRequest, BLAME_QUERY and mapBlame. Where the two copies differ, keep the safer behaviour (stats default, null repository). - Error construction uses lib/github/errors.ts from (5). - Direct mode builds URLs with shared builders (the existing parser.ts builders plus list/compare/commit builders) instead of parsing proxy URLs back in mapProxyUrlToGitHubApi. - The normalizeDirectResponse switch is deleted. | Medium. - The server path changes where it currently throws a TypeError (commit stats, blame with null repository); that is an improvement. - No new bundle boundary: fetcher.ts is already imported by client code (chat-sidebar.tsx, use-downloads.ts and four providers). - Direct URLs must stay byte-identical; client.test.ts asserts them. |
| Route PAT through the proxy | M | Delete direct mode: proxyFetch always calls /api/github/* and sends the PAT as X-GitHub-Token, which already works for file, zipball and pulls. This removes about 600 lines from client.ts and the whole class of divergence. Cache scoping by credential and epoch stays. | High until the rate limits change: - Measured: a second tree within a minute returns 429, and commit detail is capped at 60 per minute per IP per instance. PAT users who are unlimited today would hit both. - Every PAT request now passes through and is billed on the server, and costs one more hop. - The token copy in github-token-input.tsx:195 needs updating. - About 35 direct-mode tests are deleted or rewritten. |

#### Parity contract tests + prune

Files: `lib/github/__tests__/mode-parity.test.ts (new)`, `lib/github/client.ts`, `lib/github/client.test.ts`, `components/features/code/hooks/use-downloads.ts`, `components/features/code/hooks/__tests__/use-downloads.test.ts`

Tests: Generalize the client-pagination.test.ts harness: real route handlers serve '/api/github/*' and a fake GitHub serves REST and GraphQL.
- For each endpoint (repo, tree, tags, branches, commits, file commits, compare, commit detail, blame), assert the success payload deep-equals across the two modes.
- For 404, 401, 403-rate, 403-forbidden, 422, 429, 5xx and redirect, record the error message from each mode.
- List today's divergences in an explicit KNOWN_DIVERGENCES table. The suite should fail both when a listed divergence disappears and when a new one appears.
- Update client.test.ts :186-238 and :626 for the removed mappings.

Steps:

1. Write mode-parity.test.ts with the KNOWN_DIVERGENCES table, green against the current code.
2. Delete the tree, file and rate-limit branches of mapProxyUrlToGitHubApi, directFetchRawFile and normalizeRateLimit, and update the tests.
3. Make directFetchResponse use GITHUB_REQUEST_TIMEOUT_MS (from lib/github/request-signal.ts) unless the caller passes its own deadline, and add a test.
4. Switch use-downloads.ts to fetchFileViaProxy, and test a private-repo download that uses the forwarded token.

#### Shared mappers + error constructor

Files: `lib/github/mappers.ts (new)`, `lib/github/fetcher.ts`, `lib/github/client.ts`, `lib/github/parser.ts`, `lib/github/client.test.ts`, `lib/github/__tests__/fetcher-*.test.ts`, `lib/github/__tests__/mode-parity.test.ts`

Tests: Requires Option A's parity suite and (5)'s error contract to be green first. The KNOWN_DIVERGENCES table should shrink to the redirect policy only. Add unit tests for each mapper with GitHub fixtures, including a missing stats field and a null blame repository. Keep fetcher-errors.test.ts and client.test.ts URL expectations unchanged.

Steps:

1. Land Option A and (5).
2. Create mappers.ts by moving the client.ts:396-622 types and normalizers and reconciling them with fetcher.ts's inline mapping.
3. Make fetcher.ts use the mappers.
4. Replace mapProxyUrlToGitHubApi and normalizeDirectResponse with per-function direct branches that use the shared URL builders, the mappers and gitHubErrorFromResponse.
5. Delete the duplicated BLAME_QUERY.
6. Run the parity suite, client.test.ts, the route tests and tsc.

#### Route PAT through the proxy

Files: `lib/github/client.ts`, `lib/github/client.test.ts`, `lib/github/__tests__/client-pat.test.ts`, `lib/github/__tests__/client-pagination.test.ts`, `app/api/github/tree/route.ts`, `lib/api/rate-limit.ts`, `components/features/settings/github-token-input.tsx`, `ARCHITECTURE.md`

Tests: Option A's parity suite becomes a single-path contract: assert the PAT is forwarded and responses are identical. Add a tree-route refund test (refund by ResolvedRepoTree.requestCount, as tags and branches do) and a test that a session can load at least N trees per minute. Keep the cache-scoping tests at client.test.ts:241-340 and :444.

Steps:

1. Fix the tree route admission: refund by requestCount, and choose limits for authenticated requests.
2. Delete the direct branches, mappers and BLAME_QUERY from client.ts.
3. Rewrite the tests.
4. Update the token disclosure copy and ARCHITECTURE.md.
5. Load-test the main flows: indexing, compare with 3 repositories, and git history.

### Recommendation

Do Option A now: about 1 day, low risk, and it is the safety net for both this refactor and (5). Do Option B after (5) lands. Together they turn the two access layers into one data and error contract with two thin transports. Do not do Option C unless you want a single transport and accept the extra server traffic. If you do, fix the tree route's rate cost first; the measured one-tree-per-minute admission already hurts anonymous and OAuth users and should be fixed regardless (refund by requestCount, as tags and branches do).

### Decisions for the owner

- Keep PAT direct mode as a feature (browser to GitHub, no server hop), or send all PAT traffic through the RepoLens server (Option C), accepting more server invocations and app-side rate limits for PAT users?
- Should PAT direct requests follow GitHub's 301 redirects so renamed or transferred repositories work? This reverses the redirect:'error' hardening from commit 9f58af3; browsers drop the Authorization header on cross-origin redirects, and the server path already follows redirects with the forwarded PAT.
- Delete the routes and client functions that have no production consumer (/api/github/rate-limit, /api/github/refs, /api/github/languages, fetchPullRequestCommentsViaProxy), or keep them as public API?

## (5) Typed GitHub error contract instead of HTTP status from error-message substrings

Status: done, Option C (typed GitHubError end to end), with the owner's decisions: GitHub rate limits including the secondary-limit 429 stay 403 RATE_LIMIT; a non-rate-limit 403 returns a fixed FORBIDDEN message in both modes, never GitHub's text. The section below records the state before the change. The contract is pinned by app/api/github/__tests__/route-error-contract.test.ts and lib/github/__tests__/mode-parity.test.ts.

### Current state

Inventory: 28 message.includes() checks in 13 files.
- 11 files use the standard 2-check ladder ('not found' to 404, 'Rate limit' to 403, anything else to a generic 500): repo, tags, branches, refs, commits, commit/[sha], languages, pulls, pulls/[number], pulls/[number]/files and pulls/[number]/comments.
- compare adds a third check, 'Invalid request' to 422 (compare/route.ts:52-54).
- blame adds 'Authentication' to 401 (blame/route.ts:56-58).
- No route outside app/api/github derives a status from a message. app/api/deps was converted to status-based handling in commit dad70a1, and the AI and model routes return generic 500s.

Where the messages come from:
- fetchRepoMetadata (fetcher.ts:88-94).
- handleGitHubError (fetcher.ts:191-203): 404 gives '${context} not found.', 422 gives 'Invalid request for …', anything else gives 'Failed to fetch …: statusText', and every 403 gives 'Rate limit exceeded…', even permission and SAML 403s.
- Bespoke 404 messages at fetcher.ts:466, 712, 742 and 781.
- graphql.ts:33-43: 401, any other non-OK status, and errors[0].message, which is GitHub's upstream text.
- The only typed error today is GitHubResponseTooLargeError (fetcher.ts:21-26), mapped to 413 by an instanceof check in file/route.ts:44.

Routes without the ladder:
- tree/route.ts:46-52 always returns 500, but resolveRepoTree turns fetch failures into a 200 'partial' result (tree-resolver.ts:219-229).
- file/route.ts turns GitHub 404s into 500.
- rate-limit/route.ts:28-30 and zipball/route.ts:85-93 pass upstream statuses through.
- Only the tree route rethrows aborts (:47-48). Everywhere else, client aborts and the 30 s fetchGitHub TimeoutError become a logged 500.

The '422 collapses to 500' claim holds everywhere except compare. Measured with the real fetcher and real routes:
- 401 becomes 500 on every route.
- 422 becomes 500 except on compare.
- 429 becomes 500.
- A SAML or permission 403 becomes 403 with the wrong message, 'Rate limit exceeded…'.
- Blame GraphQL NOT_FOUND, RATE_LIMITED and HTTP 403 all become 500.

The redaction added in commit 2acf1d6 only makes the 5xx fallback generic and logged. The 404/403/422 branches still return the thrown message verbatim. That is mostly self-written fetcher text, but blame can forward GitHub's GraphQL text. apiError (lib/api/error.ts:16-32) does no redaction itself, and its details field is client-visible. Redaction is pinned by app/api/github/__tests__/route-error-redaction.test.ts: 18 routes must return status 500 or higher, no leaked secret, and the detail in console.error.

The app's own limiter returns 429 'RATE_LIMITED' (lib/api/rate-limit.ts:120). GitHub limits come back as 403 'RATE_LIMIT'.

On the client, proxyFetch (client.ts:716-724) and fetchBlameFromApi (:1094-1102) throw a plain Error(message) and discard both the status and the error.code. The only client code that branches on error text is hooks/use-git-history.ts:137, which detects a blame 401 by looking for '401', 'unauthorized' or 'authentication'.

Tests that pin the substring mechanism itself: 11 cases in 7 files reject a mocked fetcher with plain Error text (branches:250,259; commit:106; commits:143,152; compare:115,124,133; refs:89; tags:184,195). Six of the 13 routes (repo, languages, pulls, pulls/[number], pulls/[number]/files, pulls/[number]/comments) have no status tests apart from the redaction test.

### Impact

Real failures are reported as server errors:
- An expired OAuth token or bad forwarded PAT returns 500 'Failed to fetch tags'. The user is not told to re-authenticate.
- A secondary rate limit (429) or an invalid request (422) returns 500.
- An organization SAML block tells the user 'Rate limit exceeded… add a token', which sends them the wrong way, since they already have a token.
- Blame on a missing repository or under a rate limit returns 500.

Monitoring sees these as server errors, and client aborts and timeouts are logged as GitHub errors.

For developers: rewording a fetcher message silently changes HTTP statuses on up to 13 routes, and the current route tests would not notice, because they mock the substring and not GitHub.

Measurements: the same probe as in (4), real route handlers with fetch stubbed at the GitHub boundary.

### Options

| Option | Effort | Approach | Risk |
| --- | --- | --- | --- |
| Centralize the substring ladder | S | One helper replaces the 13 copied ladders. It keeps substring matching but adds 'Invalid request' to 422 and 'Authentication'/'Unauthorized' to 401 for every route, and makes handleGitHubError give 401 its own message. | Low, but the fragility stays: it is still prose-coupled. 429, the SAML 403 and timeouts remain misclassified unless more substrings are added. |
| Typed GitHubError, server side | M | lib/github/errors.ts, isomorphic with no next/server import, defines GitHubError. It carries: - kind: not_found \| unauthorized \| forbidden \| rate_limited \| invalid \| timeout \| too_large \| upstream. - message: user-safe text from a fixed table keyed by resource and kind, which keeps today's strings. - resource, upstreamStatus, retryAfter. - upstreamMessage, for logging only.  Helpers: - classifyGitHubStatus(status, headers): 401 is unauthorized; a 403 with x-ratelimit-remaining 0 or a retry-after header, and any 429, is rate_limited; any other 403 is forbidden; 404 is not_found; 409 and 422 are invalid; 5xx is upstream. - gitHubErrorFromResponse(response, resource): cancels or bounds the body. - A function mapping GraphQL error types to kinds.  fetcher.ts and graphql.ts throw only GitHubError and wrap TimeoutError as kind 'timeout'.  lib/api/github-error-response.ts gitHubErrorResponse(error, {tag, fallback, notFoundCode}): - rethrows aborts; - maps a GitHubError through one table to apiError(code, safe message, status) and logs the upstream detail; - turns anything else into a generic logged 500, which keeps the current redaction; - never puts upstream text in details. | Medium. Statuses and messages change on purpose for 401, 422, 429, forbidden, timeout and upstream 5xx; users will see different toast text. Recognize the class with isGitHubError(), checking name and kind as well as instanceof, because vi.mock and bundling can duplicate modules. Keep errors.ts separate from fetcher.ts so tests that mock the fetcher still get the real class. The 11 tests that pin the mechanism must be rewritten. |
| Typed GitHubError end to end | M | Option B plus the client. - proxyFetch and fetchBlameFromApi build a GitHubError from the response status and the {error:{code,message}} body. - PAT direct mode's directFetchResponse and direct blame use the same gitHubErrorFromResponse and message table, so PAT and proxy users see identical text and kinds. - use-git-history.ts:137 switches to err.kind === 'unauthorized'. This closes the error half of (4)'s measured divergence matrix without waiting for the shared mappers. | Medium. On top of Option B, PAT users stop seeing GitHub's raw text (for example the SAML detail) unless you decide to keep it for forbidden. client.test.ts:478-505 currently pins the raw GitHub text and must change on purpose. The client must not trust an arbitrary code string: map unknown codes to 'upstream'. |

#### Centralize the substring ladder

Files: `lib/api/github-route-error.ts (new)`, `lib/github/fetcher.ts`, `13 files under app/api/github/**/route.ts`

Tests: The existing route tests keep passing because they pin substrings. Add the 401 and 422 cases for each route.

Steps:

1. Write the helper with the ladder.
2. Replace each catch block.
3. Add the 401 and 422 cases to handleGitHubError and the route tests.

#### Typed GitHubError, server side

Files: `lib/github/errors.ts (new)`, `lib/github/fetcher.ts`, `lib/github/graphql.ts`, `lib/api/github-error-response.ts (new)`, `13 substring routes plus app/api/github/tree/route.ts and app/api/github/file/route.ts`, `app/api/github/__tests__/route-error-contract.test.ts (new)`, `app/api/github/__tests__/route-error-redaction.test.ts`, `7 route test files with mechanism-pinning cases`, `lib/github/__tests__/fetcher-errors.test.ts`, `lib/github/__tests__/graphql.test.ts`

Tests: Before refactoring, write route-error-contract.test.ts. It is table-driven over the 13 routes plus tree and file, crossed with upstream 404, 401, 403-rate, 403-forbidden, 422, 429, 502, timeout, network error and abort. It stubs global fetch at the GitHub boundary and uses the real fetcher and real route, recording status, code and message. Commit it green as current behaviour. The refactor's diff to this table is the behaviour change to review.

Keep fetcher-errors.test.ts message expectations unchanged; the strings live in the table. Keep route-error-redaction.test.ts passing, and add a GitHubError with a secret in upstreamMessage on a 4xx path that must not leak.

Rewrite the 11 mechanism-pinning cases to reject with GitHubError, or delete them as covered by the contract table.

Steps:

1. Write and commit the contract table test against current code.
2. Add errors.ts with unit tests for classifyGitHubStatus and the GraphQL mapping.
3. Convert fetchRepoMetadata, handleGitHubError, the bespoke 404 throws and graphql.ts. fetcher-errors.test.ts must stay green.
4. Add gitHubErrorResponse and switch the routes one at a time, including tree (abort handling) and file (404 instead of 500, keeping the 413).
5. Update the contract table rows that change on purpose and rewrite the 11 mechanism tests.
6. Extend the redaction test, then run tsc, eslint and vitest.

#### Typed GitHubError end to end

Files: `Option B's files`, `lib/github/client.ts`, `lib/github/client.test.ts`, `hooks/use-git-history.ts`, `hooks/__tests__/use-git-history.test.ts`, `lib/github/__tests__/mode-parity.test.ts`

Tests: Use Option B's contract table, plus (4)'s mode-parity suite asserting the same error kind and message in both modes; remove error rows from KNOWN_DIVERGENCES. Add a use-git-history test that a blame 401 from both proxy and direct mode shows the 'Login required' message.

Steps:

1. Do Option B's steps.
2. Make proxyFetch and fetchBlameFromApi parse status and code into a GitHubError, with tests.
3. Make directFetchResponse and direct blame use gitHubErrorFromResponse; update client.test.ts:478-505 and the parity table.
4. Switch use-git-history.ts to check the error kind; run the suites.

### Recommendation

Option C, typed GitHubError end to end. It fixes the measured misreports (401, 422, 429, SAML 403, blame, timeouts) and makes redaction structural: only table-driven, self-written messages reach clients, and upstream text is only logged. It also removes most of (4)'s user-visible divergence. Option A is a stopgap that keeps the fragility.

Recommended status table, unless you decide otherwise below:
- not_found 404, keeping each route's current REPO_NOT_FOUND or NOT_FOUND code.
- unauthorized 401 AUTH_REQUIRED.
- forbidden 403 FORBIDDEN.
- rate_limited 403 RATE_LIMIT, with Retry-After taken from the upstream reset.
- invalid 422 VALIDATION_ERROR.
- timeout 504 GITHUB_TIMEOUT.
- upstream 502 GITHUB_ERROR.
- too_large 413.
- Anything that is not a GitHubError: 500 generic.

### Decisions for the owner

- Do you accept these status changes on /api/github/*: upstream 401 becomes 401 (today 500), 422 becomes 422 on every route (today 500 except compare), upstream 5xx becomes 502 and timeouts 504 (today 500), and non-rate-limit 403s get their own FORBIDDEN code? For GitHub rate limits, including the secondary-limit 429, keep 403 RATE_LIMIT as today, or switch to 429? The app's own limiter already uses 429 RATE_LIMITED.
- For a GitHub 403 that is not a rate limit (SAML/SSO enforcement, missing permission), may the client see GitHub's own message, which is actionable (for example 'authorize this token for the org')? Or only a fixed RepoLens message, under strict redaction? PAT direct mode shows GitHub's text today; the proxy shows a wrong 'Rate limit exceeded' text.
