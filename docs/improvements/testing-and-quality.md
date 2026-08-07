# Testing Quality & Coverage Gaps — Improvement Notes

_Honest summary: a large (231-file) suite that is genuinely good in pockets, but whose two most load-bearing correctness stories — the scanner accuracy sweep and the AI agent loop — measure or mock instead of asserting, and whose flagship route (`/api/chat`) has no test that imports it. Severity legend: **CRITICAL** (ship-blocking) · **HIGH** (real regression can ship green) · **MEDIUM** (meaningful hole) · **LOW** (hardening)._

## Overall assessment

There is real quality here. `lib/code/scanner/__tests__/real-repo-validation.test.ts` enforces actual gates — `expect(recall).toBeGreaterThanOrEqual(80)` (line 361) and `expect(avgFP).toBeLessThanOrEqual(2)` (line 381). The GitHub client/fetcher tests exercise real handlers with focused mocks, and `app/api/deps/__tests__/route.test.ts` imports the real `POST` handler and asserts concrete 200/422/400 branches including path-traversal rejection (lines 183–243). `client-tool-executor` tests build a real `CodeIndex`.

But the headline tests oversell. The 220+-fixture accuracy sweep computes per-rule TP/FP/recall and then throws it all away — every per-fixture assertion is `toBeDefined()`, misses are reported via `console.warn`, and the summary only checks that fixtures *exist*. The `/api/chat` route — the product's flagship AI feature — has zero tests that import `route.ts`; its two test files re-declare the schema inline, and one copy is *already stale* (missing `activeSkills`), which is direct proof the "catches drift" claim is false. The "agent integration" test mocks the entire agent loop and verifies only tool count. Net: the suite catches coarse breakage and shape regressions but would let a whole scanner rule-set silently stop firing, an agent-loop wiring bug, or a chat-route regression ship green.

No CRITICAL issues. Two HIGH, three MEDIUM, one LOW survived verification.

## Findings

### [HIGH] 220-fixture "accuracy sweep" enforces no accuracy — regressions only `console.warn`

- **Where:** `lib/code/scanner/__tests__/accuracy-sweep/accuracy-sweep.test.ts:209-234` (per-fixture), `:296-301` (summary)
- **Problem:** The sweep runs 220+ fixtures across 12 languages and computes full per-rule/per-category TP/FP/missed/FP-rate metrics (`computeSweepSummary`, lines 81–161). Then it discards them. Each per-fixture `it()` asserts only `expect(result).toBeDefined()` and `expect(result.issues).toBeInstanceOf(Array)` (lines 232–233). Missed true-positives (`missedTPs`, line 209) and unexpected findings are emitted via `console.warn` with the explicit comment "Report but don't fail — this is a measurement harness" (line 214). The summary test asserts only `summary.totalFixtures >= 220` (line 297) and `totalAnnotated >= 160` (line 301) — i.e. the fixtures exist and are annotated, not that the scanner detects anything.
- **Impact:** If a refactor breaks an entire language's rule set (e.g. all Python taint rules stop firing, or a regex change suppresses SQL-injection detection), every sweep test stays green. The most comprehensive scanner test in the repo cannot fail on a correctness regression. The only real gate (`real-repo-validation.test.ts`) covers a handful of snippets — a small fraction of the 160+ annotated cases here.
- **Recommendation:** The metrics are already computed — turn them into assertions. In the per-fixture test, fail when a `verdict:'tp'` expected finding is in `missedExpected` (replace the `console.warn` at 210–218 with `expect(missedTPs).toHaveLength(0)`). In the summary test, assert an overall recall floor and a per-category FP-rate ceiling using `summary.perCategory`/`summary.perRule`. Keep the `console.table`/JSON output for diagnostics, but stop letting it substitute for `expect()`.
- **Effort:** M · **Confidence:** high

### [HIGH] Core `/api/chat` route handler has zero tests that import it

- **Where:** `app/api/chat/route.ts:32-91` (the untested `POST`); `app/api/chat/__tests__/route-skills.test.ts:8-29`; `app/api/chat/__tests__/route-pinned.test.ts:8-26`
- **Problem:** Neither chat test file imports `route.ts`. A grep for route imports in `app/api/chat/__tests__/` returns nothing. Each file re-declares the request zod schema inline and validates that copy. No test exercises the real `POST`: rate limiting (line 33), the 400-on-bad-JSON branch (line 40), the 422 validation branch (lines 45–52), `createAgentUIStreamResponse` wiring (lines 56–82), or the 500 error mapping (lines 83–90). By contrast `changelog/generate/__tests__/route.test.ts:33`, `models/*/route.test.ts:2`, and `deps/__tests__/route.test.ts:183` all import their real handlers — chat is the notable gap, and it is the highest-traffic route.
- **Impact:** The server entry point for the flagship AI-chat feature is uncovered. A regression in body parsing, provider/model plumbing (`...rest` spread into `options`, line 59), or failure-to-HTTP-status mapping ships green.
- **Recommendation:** Add a route-level test that imports `POST` from `app/api/chat/route.ts`, mocks the `ai` SDK (as `changelog/generate` and `deps` already do — see `deps/route.test.ts` dynamic-import pattern at lines 182–184), and asserts: 400 on invalid JSON, 422 on invalid body, that `provider`/`model`/`apiKey` reach `createAgentUIStreamResponse` options, and that a downstream throw becomes the 500 `CHAT_ERROR` response.
- **Effort:** M · **Confidence:** high

### [MEDIUM] Chat & docs route tests re-declare zod schemas inline and claim to "catch drift" — they can't

- **Where:** `app/api/docs/generate/__tests__/route-schema.test.ts:6-30` (the *only* test for that route); `app/api/chat/__tests__/route-skills.test.ts:15-29`; `app/api/chat/__tests__/route-pinned.test.ts:13-26`
- **Problem:** These tests copy the route's validation schema into the test file. `route-schema.test.ts:8` states the copy "catches drift." It cannot — it validates zod against zod, always agreeing with its own copy; `route.ts` is never imported and the docs route doesn't even export its schema. **Concrete proof the claim is false:** `route-pinned.test.ts`'s copy (lines 13–26) is *already out of date* — the real `app/api/chat/route.ts:29` added an `activeSkills` field that the pinned-test copy omits. The duplicated schema drifted from production and no test noticed.
- **Impact:** If someone loosens the real chat/docs schema (raises `apiKey` max, changes the provider enum, drops a bound), these tests keep asserting the old contract and pass. The tests assert nothing about the code that runs in production. For `docs/generate` this is the route's only test at all.
- **Recommendation:** Extract each route's schema into a sibling `schema.ts` that `route.ts` imports, then import *that* into the test so the real object is exercised (avoids pulling the AI SDK/env into the test). Delete the inline copies.
- **Note / correction to first reviewer:** The proposed finding also cited `app/api/deps/__tests__/route.test.ts` as tautological. That is **refuted** — the deps test file duplicates the schema *and* imports the real `POST` handler, asserting 200/422/400 and path-traversal rejection against production code (lines 182–243). Deps is one of the better-tested routes; only docs/generate and chat are genuinely tautological.
- **Effort:** S · **Confidence:** high

### [MEDIUM] "Agent integration" test mocks the entire agent loop; only tool count is verified

- **Where:** `lib/ai/agent/__tests__/agent-integration.test.ts:4-26` (mocks), `:36-39` (the only substantive assertion)
- **Problem:** The test `vi.mock`s the `ai` SDK's `ToolLoopAgent` (replaced by a stub that just stores `opts.tools`, lines 5–12), `createAIModel` (line 15), `buildPrepareCall` (line 20), and `buildPrepareStep` (line 24). What remains testable is `Object.keys(tools).length === 15` (line 39) and tool-name presence (lines 42–71). The prepare-call/prepare-step logic, multi-step tool execution, context compaction under token pressure, and tool-result feedback — the actual agent behavior — are never run.
- **Impact:** A bug in how prepare-step trims context, how tool results feed back, or how the loop terminates is caught by no integration test, because the loop and all collaborators are mocked. Given the agent is central to chat/docs/changelog, this is the coverage hole on the most complex control flow in `lib/ai`. The name oversells: it is a registration test.
- **Recommendation:** Rename this to `agent-registration.test.ts`. Add a real integration test that runs the actual `ToolLoopAgent` (or the real `buildPrepareStep`/`buildPrepareCall`) against a fake model emitting a scripted tool-call sequence, and assert the loop executes tools, feeds results back, compacts context, and terminates.
- **Effort:** L · **Confidence:** high

### [MEDIUM] E2E depends on live GitHub, silently skips on rate limits, and accepts the landing-page headline as a passing "error" state

- **Where:** `e2e/repo-loading.spec.ts:121-129` (invalid-URL assertion), `:216-233` (skip-on-not-connected), `playwright.config.ts:18-23` (dev-server)
- **Problem:** E2E runs against `pnpm dev` (`playwright.config.ts:19` — on-demand compile, hence the 120–180s timeouts and `retries:2`) and hits real repos (`public-apis/public-apis`, `pmndrs/zustand`) with no network stubbing. The "invalid GitHub URL" test passes if body text includes ANY of `Invalid`/`error`/`Error`/`Failed` **OR** `Understand Any GitHub` (lines 124–126) — that last string is the landing-page headline (see `loadApp`, line 28), so an app that silently does nothing still passes. The file-navigation test calls `test.skip(...)` when the repo doesn't connect (lines 230–232, "GitHub API may be rate-limited"), so a rate-limited or broken CI run reports green while exercising nothing.
- **Impact:** These tests are both flaky (live network + dev-mode compile + generous OR-of-substrings) and non-gating (skip-on-failure, landing-page-as-success). A regression that breaks repo loading can pass because the fallback substring or the skip path is hit.
- **Recommendation:** Run E2E against a production build (`next build && next start`) not `pnpm dev`. Stub GitHub via Playwright `page.route()` interception with fixture zipballs so tests are deterministic and rate-limit-proof. Tighten the error-state assertion to a specific error UI element, and drop `Understand Any GitHub` from the OR. Convert the skip-on-not-connected into a hard failure once the network is stubbed.
- **Effort:** L · **Confidence:** high

### [LOW] Coverage thresholds (20% branches/functions) are too low to gate a security-scanner product

- **Where:** `vitest.config.ts:54-59`
- **Problem:** Thresholds are statements 35%, branches 20%, functions 20%, lines 35%. For a ~61k-LOC app whose core value is a security/quality scanner (`rules-security.ts` ~1403 LOC, `scanner.ts` ~1244 LOC), a 20% branch floor means the large majority of error/edge/negative branches can be entirely uncovered while the check still passes.
- **Impact:** The numeric gate cannot catch the removal of tests for whole modules or the addition of untested error paths — it fails only if coverage collapses below one-fifth. Combined with the accuracy-sweep and chat-route gaps above, it provides little protection for critical branches (auth token handling, scanner edge cases, GitHub error mapping).
- **Recommendation:** Ratchet the global thresholds toward current actual coverage, and add per-directory thresholds for high-risk areas (`lib/code/scanner`, `lib/github`, `lib/api`, `app/api`) so those cannot regress even if the global average stays high. v8 provider supports per-path threshold globs in `coverage.thresholds`.
- **Effort:** S · **Confidence:** medium

## Suggested order of work

1. **Make the accuracy sweep assert** (HIGH, M) — biggest bang: flip the already-computed `missedTPs`/`perCategory` metrics into `expect()` gates so the scanner's flagship test can actually fail on a correctness regression.
2. **Add a real `/api/chat` route test** (HIGH, M) — import `POST`, mock the `ai` SDK, cover 400/422/500 and provider plumbing. Reuse the `deps/route.test.ts` dynamic-import pattern.
3. **Extract & import route schemas** (MEDIUM, S) — move chat/docs schemas to `schema.ts`, import into tests, delete inline copies. Fixes the already-stale `activeSkills` drift for free.
4. **Write a genuine agent-loop integration test** (MEDIUM, L) — scripted fake model through the real `ToolLoopAgent`; rename the existing test to `-registration`.
5. **Harden E2E** (MEDIUM, L) — production build + `page.route()` GitHub stubs + tighter error assertions + remove skip-on-not-connected.
6. **Ratchet coverage thresholds** (LOW, S) — global bump plus per-directory floors on `lib/code/scanner`, `lib/github`, `app/api`. Do this last, after 1–5 raise real coverage, so the new floor reflects meaningful tests.
