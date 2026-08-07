# Architecture & Maintainability — Improvement Notes

_Honest summary: the layering is more disciplined than the raw file sizes suggest, and the docs largely match the code. The real risks are a small set of duplication/coupling patterns that amplify every future edit. Severity legend: **critical** = will break / silently corrupt behavior soon · **high** = latent correctness trap or heavy edit-amplification · **medium** = maintainability drag · **low** = minor/cosmetic._

## Overall assessment

The architecture holds up under scrutiny. Server route handlers (`app/api/github/*`) delegate to `lib/github/fetcher`, the browser talks through `lib/github/client` `*ViaProxy` wrappers, and UI consumes core logic through React context providers rather than reaching into internals. The oversized files are mostly cohesive (a long rule table, a dispatcher plus per-tool functions) rather than tangled. `ARCHITECTURE.md`/`AGENTS.md` are unusually accurate and a genuine asset.

The weaknesses are narrow and specific: (1) the scan pipeline exists as two near-verbatim copies that **have already silently diverged**; (2) HTTP status codes are derived from thrown error-message substrings with no typed contract; (3) the GitHub integration is a 3-layer parallel structure plus ~13–18 near-identical route files; and (4) a couple of god components concentrate too much state. None are architecture-breaking, but all four are exactly the friction that compounds as the surface grows. All five proposed findings were verified in the actual code and survive; none were dropped.

## Findings

### [HIGH] Scan pipeline exists as two near-verbatim copies — and they have already diverged

- **Where:** `lib/code/scanner/scanner.ts:638-846` (sync `scanIssues`) vs `lib/code/scanner/scanner.ts:905-1134` (async `scanIssuesAsyncImpl`)
- **Problem:** Both functions reimplement the entire orchestration — cache check, `SCANNER_EXCLUDE_PATTERNS` filtering, `presentExtensions`/`filesByExtension` precompute, `runRegexRules`, AST/taint, dedup, composite, structural, supply-chain, context cross-reference, sort, risk scoring, `computeHealthGrades`. The file-filtering and extension-precompute blocks (`scanner.ts:664-694` vs `923-955`) are copied line for line; the async version differs only by interspersed `await yieldToMain()` / `isStale()` guards.
- **Impact:** This is not hypothetical — the two paths have **already diverged**. The async path has a "Phase 5b: Tree-sitter multi-language analysis" step (`scanner.ts:1049-1063`, the only call site of `scanWithTreeSitter`), and the sync `scanIssues` has no equivalent. So `scanOnDemand` (`scanner.ts:1145-1151`, which calls the sync path) and any sync/test callers silently skip tree-sitter findings that the async UI path reports. Result differs by entry point — the exact class of bug that is hard to notice because both paths "work." Every future pipeline change (new phase, dedup fix, grading tweak, exclusion change) must be applied twice or the drift widens.
- **Recommendation:** Extract the shared orchestration into one phase-driven core — e.g. an ordered array of phase closures `(ctx) => void | Promise<void>` operating on a shared mutable `ScanContext` (`issues`, `seenIds`, `filesToScan`, counters). `scanIssues` iterates phases eagerly; `scanIssuesAsyncImpl` awaits `yieldToMain()` / checks `isStale()` between phases. This removes ~200 duplicated lines and makes the sync/async results provably identical (including tree-sitter, once it is a shared phase). Add a test asserting `scanIssues` and `scanIssuesAsync` produce the same issue set on a fixture.
- **Effort:** M · **Confidence:** high

### [HIGH] HTTP status codes are derived from thrown error-message substrings

- **Where:** `app/api/github/tags/route.ts:48-59`, `app/api/github/branches/route.ts:48-59` (pattern repeated in 13 github route files), producing strings at `lib/github/fetcher.ts:33-41` and `lib/github/fetcher.ts:134-145`
- **Problem:** Route catch-ladders map errors to status by matching free text: `message.includes("not found")` → 404, `message.includes("Rate limit")` → 403, else 500. The messages are produced far away in `fetcher.ts` as plain `throw new Error('Repository not found...')` (line 35) and `throw new Error('Rate limit exceeded...')` (lines 38, 139), and via `handleGitHubError` (`fetcher.ts:134-145`) as `` `${context} not found.` ``. There is no typed error contract between the layers — only prose that happens to contain the right words. `grep` confirms 13 route files rely on this substring match.
- **Impact:** Rewording a fetcher message (e.g. "Repository could not be located", or localizing strings) silently downgrades a 404/403 to a 500 across every route that rethrows it. Clients keying off status then misbehave: retry storms on what is really a 404, wrong UI on rate limits. Already fragile in a subtle way — `handleGitHubError`'s 422 branch (`fetcher.ts:141-143`) throws "Invalid request for …", which matches neither substring and collapses to 500, so a real 422 is reported as a server error today.
- **Recommendation:** Add a typed error in `lib/github` — `class GitHubError extends Error { kind: 'not_found' | 'rate_limit' | 'invalid' | 'auth' | 'unknown'; status: number }` — throw it from the fetcher/`handleGitHubError`, and add one shared helper `githubErrorToResponse(err)` that maps `kind`/`status` → `apiError(...)`. Routes stop pattern-matching prose and the 422 path stops being mis-reported. This pairs naturally with the next finding (a shared route wrapper is the single place that helper lives).
- **Effort:** M · **Confidence:** high

### [MEDIUM] GitHub integration duplicates a 3-layer parallel structure per endpoint plus ~13–18 near-identical route files

- **Where:** `app/api/github/tags/route.ts:1-61`, `app/api/github/branches/route.ts:1-61` (18 `route.ts` files under `app/api/github/`), `lib/github/client.ts` (`fetch*ViaProxy` wrappers), `lib/github/fetcher.ts` (`fetch*`)
- **Problem:** `tags/route.ts` and `branches/route.ts` are byte-for-byte identical except the schema variable name, the fetcher function called, the `Cache-Control` max-age, and one noun in the fallback message. The rate-limit guard (`applyRateLimit`), Zod `safeParse`-from-`searchParams` boilerplate, `VALIDATION_ERROR` branch, and the not-found/rate-limit/500 catch ladder are copy-pasted. Separately, each GitHub resource is implemented three times in parallel: a client-side `fetchXViaProxy` (`lib/github/client.ts`), a server-side `fetchX` (`lib/github/fetcher.ts`), and a `route.ts` wiring them together.
- **Impact:** High edit-amplification. A change to rate-limit handling, validation shape, or error mapping must be applied to every route by hand — and the error-string coupling above is exactly one such cross-cutting concern already living duplicated across 13 of them. The 3-layer parallelism makes it easy to update the fetcher and forget the `ViaProxy` wrapper (or vice versa), producing client/server drift. This is the single biggest source of ongoing boilerplate in the API surface. (Note: a handful of the 18 routes — `rate-limit`, `validate-token`, `refs` — legitimately differ and would not fit a generic wrapper; the finding targets the ~13 resource-proxy routes, not all 18.)
- **Recommendation:** Factor a `createGitHubProxyRoute({ schema, fetch, cacheControl })` higher-order handler that owns the rate-limit guard, `searchParams`→Zod parse, and the shared catch ladder (calling the typed-error helper from the previous finding). Each resource route collapses to ~6 lines of config. Optionally drive the `ViaProxy`/fetcher/route triples from one descriptor list so they cannot drift.
- **Effort:** M · **Confidence:** high

### [MEDIUM] `global-search-overlay.tsx` is a 1064-line god component with 19 `useState` hooks

- **Where:** `components/features/preview/global-search-overlay.tsx` (1064 lines; 19 `useState` calls confirmed via grep)
- **Problem:** One component combines: files tab, symbols tab, worker-backed code-content search, regex/case/whole-word/exclude toggles, a replace mode, and a multi-file rename flow, plus virtualization and debouncing. Search orchestration, symbol extraction, rename mutation, and presentation all live in one file with 19 pieces of local state.
- **Impact:** Any change (adding a search scope, fixing a replace edge case) requires understanding all four modes at once, raising regression risk in unrelated tabs and forcing a large test file just to pin behavior. State is hard to reason about and none of it is reusable elsewhere.
- **Recommendation:** Extract per-tab logic into hooks (`useFileSearch` / `useSymbolSearch` / `useCodeSearch`) and pull the replace/rename mutation into its own hook or module, leaving the component as a thin tab shell. Each concern then becomes independently testable. This is a refactor for maintainability, not a correctness fix — schedule it behind the two HIGH items.
- **Effort:** M · **Confidence:** medium

### [LOW] `ARCHITECTURE.md` documents the lazy-content threshold as 200 MB but the code uses 250 MB

- **Where:** `config/constants.ts:66` (`LAZY_CONTENT_THRESHOLD_KB = 250_000`) vs `ARCHITECTURE.md:19` ("Repo < 200MB?"), `ARCHITECTURE.md:73` ("`LAZY_CONTENT_THRESHOLD_KB` (200,000 KB)"), and `ARCHITECTURE.md:688` ("repo > 200MB")
- **Problem:** The constant is 250,000 KB (~250 MB) but three places in the doc state a 200 MB / 200,000 KB boundary.
- **Impact:** Minor but telling — the docs are otherwise unusually accurate, so this specific drift can mislead someone reasoning about the in-memory/IDB/lazy tier boundaries or debugging OOM on a ~220 MB repo, which now takes the IDB path the doc claims should be lazy.
- **Recommendation:** Update the three `ARCHITECTURE.md` references to 250 MB / 250,000 KB. Better: add a tiny doc test (or generate the number into the doc) that reads `LAZY_CONTENT_THRESHOLD_KB` so the value cannot silently diverge again.
- **Effort:** S · **Confidence:** high

## Suggested order of work

1. **[HIGH] Unify the scan pipeline** (`scanner.ts`) — highest value: fixes an already-live divergence (sync path missing tree-sitter) and removes ~200 lines of lockstep-edit risk. Add the sync-vs-async equivalence test.
2. **[HIGH] Introduce typed GitHub errors** (`lib/github`) — kill the status-from-substring coupling; incidentally fixes the 422→500 mis-report.
3. **[MEDIUM] Extract `createGitHubProxyRoute`** — lands naturally on top of step 2 (the shared handler is where the typed-error helper lives); collapses ~13 routes to config.
4. **[MEDIUM] Decompose `global-search-overlay.tsx`** into per-tab hooks — maintainability, schedule after the correctness items.
5. **[LOW] Fix the 200→250 MB doc drift** — 5-minute edit, ideally backed by a constant-reading assertion.
