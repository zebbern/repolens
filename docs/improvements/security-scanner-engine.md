# Security Scanner Engine — Improvement Notes

_The scanner is an ambitious, well-layered heuristic assistant, but its highest-value layer (taint tracking) emits confident false positives on very common code, and the accuracy harness that is supposed to prove trustworthiness is structurally blind to false positives. Treat output — especially taint and secret findings — as triage input, not an oracle._

**Severity legend:** Critical = actively misleads users on security-critical output at scale · High = systematic wrong/missing findings on common code, or measurement that can't catch regressions · Medium = real correctness/trust gap with narrower blast radius · Low = polish.

## Overall assessment

The architecture is genuinely above average for a client-side tool: single-pass compiled-regex scanning, context suppression (comments / test files / string literals), entropy filtering for secrets, per-rule caps, AST rules, intraprocedural taint tracking, composite/supply-chain passes, and a structural cross-reference that downgrades dead code and tags entry points. That machinery clearly reduces naive false positives.

The weaknesses are concentrated and real. The taint tracker treats `process.env` as an attacker-controlled source and auto-taints params named `context`/`ctx`, then emits *every* taint finding at `confidence:'high'` — so env-driven `fetch()` and GraphQL resolvers produce confident false SSRF/injection findings. Each `TaintSink` declares a `severity`, but the converter ignores it and remaps by sink *type*, silently downgrading genuinely critical DOM-injection sinks to `warning`. The accuracy sweep only measures FPs against findings that already matched an `fp`-annotated line, so a rule firing 50 times on secure code shows 0% FP rate, and the suite never fails on any accuracy regression. Secret-rule exclusion lists include bare English words (`type`, `message`, `field`, `label`) tested against the whole line, so real secrets sharing a line with those words are silently dropped. Finally there is no per-line length guard, so a committed minified bundle not named `*.min.*` gets every regex run against one giant line.

None are individually fatal, but together they mean the security tab overstates both its accuracy and its coverage. All eight proposed findings were confirmed against the code; none were dropped.

## Findings

### [HIGH] `process.env` treated as a taint source produces confident false SSRF / injection findings
- **Where:** `lib/code/scanner/taint-tracker.ts:70`, `:505-519`, `:618`
- **Problem:** `process.env` is in `DEFAULT_SOURCES` (line 70, `type: 'environment'`). In `checkCallSink`, the direct-source path (505-519) flags any sink call whose argument text matches *any* source pattern, and `taintFlowsToIssues` hardcodes `confidence: 'high'` (618). So `fetch(process.env.API_URL)`, `axios(process.env.BASE_URL)`, `new Function(process.env.X)`, `fs.readFile(process.env.PATH)` all emit a taint issue. The same applies to the propagation path (`const url = process.env.X; fetch(url)`).
- **Impact:** Reading a URL/path/config from an env var — one of the most common legitimate patterns in server code — is reported as SSRF (CWE-918) / path-traversal / code-injection at high confidence. On a typical Next.js/Express repo this fires repeatedly on non-vulnerabilities. (Note the severity is emitted as `warning` because `ssrf`→`warning` in the map, but it is still a prominent, high-confidence false finding.)
- **Recommendation:** Env vars are developer-controlled, not attacker-controlled in the usual threat model. Either exclude `process.env` from network/path/code sinks, or downgrade env-sourced flows to `confidence: 'low'`. Derive issue confidence from `flow.source.type` instead of hardcoding `'high'` (e.g. `environment` → low, `user-input` → high, `browser-input` → medium).
- **Effort:** S · **Confidence:** high

### [HIGH] Auto-tainting params named `context`/`ctx` false-positives on GraphQL/React server context
- **Where:** `lib/code/scanner/taint-tracker.ts:312`, `:330-339`, `:618`
- **Problem:** `AUTO_TAINT_PARAM_NAMES` includes `'context'` and `'ctx'` (line 312). Any function whose parameter is named `context`/`ctx` gets a synthetic taint source (330-339), and any derived value reaching a sink is reported at `confidence:'high'`. In GraphQL resolvers the signature is `(parent, args, context, info)` where `context` is the *server* context (db handles, auth session) — not user input. `ctx` is user-controlled only in Koa.
- **Impact:** `context.db.query(...)` or a query built from `context` fields in a GraphQL resolver produces a high-confidence false SQL/NoSQL/injection finding. This is a systematic FP class for any GraphQL or React-context codebase.
- **Recommendation:** Drop `'context'` from `AUTO_TAINT_PARAM_NAMES` entirely. Gate `'ctx'` on Koa-specific member access (`ctx.request` / `ctx.query` / `ctx.params`) rather than the bare param name. Keep `req`/`request` but lower the confidence for all synthetic-source flows.
- **Effort:** S · **Confidence:** high

### [HIGH] Accuracy sweep does not measure false positives on secure code and never fails the build
- **Where:** `lib/code/scanner/__tests__/accuracy-sweep/accuracy-sweep.test.ts:99-111`, `:60-63`, `:209-233`, `:296-302`; `.../types.ts:9-16`
- **Problem:** FP rate is computed only from findings that *matched* an expected annotation carrying `verdict:'fp'` (99-104). Findings on secure fixtures (`expected: []`) become `unmatchedActual` and are counted only as `totalFires` — the comment at line 110 explicitly says "not as TP or FP". Matching is by `ruleId + line` only (61-63), so severity and CWE correctness are never validated. The per-fixture tests only `console.warn` on missed TPs / unannotated findings and assert only that a result object exists (232-233). The summary test asserts only fixture count ≥220 and annotation count ≥160 (297-301). Nothing fails CI on an accuracy regression.
- **Impact:** The harness meant to prove the scanner is trustworthy cannot catch any of the FP classes above — a rule that fires 50 times on the secure corpus reports 0% FP rate. Reported FP numbers systematically understate reality, and there is no guardrail against regressions.
- **Recommendation:** Count every finding on an expected-clean fixture (or any finding not matching a `tp` annotation) as a false positive. Add hard assertions: a maximum FP budget (e.g. total FPs ≤ N, or per-rule fpRate below a threshold) and a minimum TP recall, so the suite fails on regression. Validate `severity` and `cwe` on matched findings, not just `ruleId + line`.
- **Effort:** M · **Confidence:** high

### [MEDIUM] NoSQL sink pattern matches `Array.prototype.find`/`.where`/`.aggregate`
- **Where:** `lib/code/scanner/taint-tracker.ts:117` (with `:506`)
- **Problem:** The NoSQL sink pattern is `/\.(find|findOne|findById|findOneAndUpdate|aggregate|where)\s*\(/`, which matches any `.find(` / `.where(` / `.aggregate(` — `Array.prototype.find`, lodash `.find`, knex `.where`, RxJS, etc. Combined with `req`/`context` auto-taint and the direct-source path (506), `arr.find(x => x.id === req.params.id)` matches the sink with a source-bearing argument.
- **Impact:** Ordinary array iteration inside a request handler is reported as "NoSQL injection" (CWE-943, warning). This is an extremely common pattern, so benign code is mislabeled as a security vulnerability.
- **Recommendation:** Require a receiver hint before treating `.find`/`.where`/`.aggregate` as a NoSQL sink — e.g. a preceding model/collection identifier (`Model.`, `db.`, `collection.`, `mongoose`), or restrict to calls whose argument is an object literal rather than a callback function. At minimum, do not treat a call whose sole argument is an arrow/function expression as a NoSQL sink.
- **Effort:** M · **Confidence:** high

### [MEDIUM] Per-sink `severity` is dead code; type-map downgrades critical DOM-injection sinks to `warning`
- **Where:** `lib/code/scanner/taint-tracker.ts:106-111`, `:570-578`, `:600`
- **Problem:** Every `TaintSink` declares its own `severity`, but `taintFlowsToIssues` ignores it and maps by `sink.type` via `SINK_SEVERITY_MAP` (600). `insertAdjacentHTML` (106), `element.srcdoc` (107), and `setAttribute(on*)` (110) are declared `severity:'critical'` but their `type` is `'xss'`, which the map resolves to `'warning'`. So genuinely critical DOM-injection sinks are emitted as warnings while the `sink.severity` field has no effect.
- **Impact:** Severity output is internally inconsistent and understates high-risk XSS sinks. The `sink.severity` field reads as authoritative in the catalog but is unused — a maintenance trap where editing it changes nothing.
- **Recommendation:** Use `flow.sink.severity` directly, falling back to `SINK_SEVERITY_MAP[flow.sink.type]` only when absent. Then reconcile the catalog so declared severities match intent (the three critical DOM sinks should stay critical).
- **Effort:** S · **Confidence:** high

### [MEDIUM] Over-broad `excludePattern` on secret/password rules suppresses real secrets (false negatives)
- **Where:** `lib/code/scanner/rules-security.ts:39`, `:57` (applied at `scanner.ts:235`)
- **Problem:** The `hardcoded-secret` and `hardcoded-password` `excludePattern`s include very common words as bare substrings / word-boundaries: `type\b`, `message`, `field`, `\bform\b`, `\binput\b`, `\bdisplay\b`, `label`, `i18n`, `param`, `arg`. The exclusion is tested against the *entire line* (`rule.excludePattern.test(lineContent)`, scanner.ts:235), so any line that also contains one of these words is dropped even when it assigns a real secret.
- **Impact:** Real leaks are silently missed — e.g. `const apiKey = "AKIAsecretvalue123" // message type`, or an object-literal line mixing a secret assignment with a `type`/`label`/`message` field. For a secrets scanner, silent false negatives are worse than false positives because "no finding" is read as "safe".
- **Recommendation:** Apply the exclusion to the captured key/value (use the `EXTRACT_SECRET_VALUE`-style capture) rather than the whole line, and drop generic English words (`message`, `field`, `type`, `label`, `display`) from the secret exclusion set. Rely on the entropy check already gating `secret` rules for value quality. Keep genuinely disambiguating tokens (`process.env`, `example`, `placeholder`, `schema`).
- **Effort:** M · **Confidence:** medium

### [MEDIUM] No per-line / minified-file guard in the regex pass — performance exposure on bundled files
- **Where:** `lib/code/scanner/scanner.ts:222-233`, `:369-379`; `constants.ts:55`; `rules-security.ts:144`
- **Problem:** `runRegexRules` iterates lines and runs every applicable compiled regex against each line with no line-length cap (222-233); the multi-line pass joins 2-3 lines and does the same (369-379). `SKIP_VENDORED` (constants.ts:55) excludes `dist`/`build`/`.min.`/lockfiles, but a committed bundled/minified file that lives elsewhere and is *not* named `*.min.*` (common: a single 200 KB–1 MB line) is scanned in full. Several rules use unbounded `.*` with alternation (e.g. `sql-injection`, line 144), and the taint file guard (`MAX_TAINT_FILE_BYTES`) does not protect the regex pass.
- **Impact:** A repo containing a large single-line bundle can pin the CPU for seconds running dozens of backtracking regexes against one giant line, freezing the tab. `scanIssues` is synchronous; even `scanIssuesAsync` runs the whole regex phase in one shot without yielding per file. (This is a performance/DoS concern more than classic exponential ReDoS — the risk is quadratic scanning × many rules × giant line, not a single catastrophic pattern.)
- **Recommendation:** Skip or truncate lines above a threshold (e.g. > 2–5k chars) in both regex passes. Add a whole-file heuristic (max avg line length, or single-line file over N bytes) to `SKIP_VENDORED`-style filtering to detect minified/generated content beyond the `.min.` name check.
- **Effort:** S · **Confidence:** medium

### [MEDIUM] Global `MAX_PER_RULE = 15` silently drops security findings beyond the cap
- **Where:** `lib/code/scanner/scanner.ts:27`, `:288-293`
- **Problem:** `MAX_PER_RULE` caps each rule at 15 findings across the *entire* codebase (`ruleCounts` is keyed by `rule.id`, not per file). Additional matches — including critical ones like `sql-injection` or `hardcoded-secret` — are dropped and only tallied in `ruleOverflow`.
- **Impact:** A repo with 40 SQL-injection sites shows only 15 in the issues list. A user scanning for security coverage sees a truncated picture and may conclude the remaining sites are clean. `ruleOverflow` is surfaced in `ScanResults`, but the individual findings (and their file:line) are gone, and the overflow count is easy to miss in the UI.
- **Recommendation:** Exempt `severity:'critical'` security rules from the cap, or cap per file rather than per repo. At minimum make the cap configurable and surface overflow prominently (with an expand affordance) so users know findings were hidden.
- **Effort:** M · **Confidence:** high

## Suggested order of work

1. **Fix the taint-tracker FP sources (F1, F2)** — remove `process.env` from injection/network sinks and `context` from auto-taint; derive confidence from source type instead of hardcoding `'high'`. Highest trust impact, smallest change (both S).
2. **Fix the severity plumbing (F5)** — use `flow.sink.severity`; one-line change that stops silently downgrading critical DOM sinks.
3. **Harden the accuracy sweep (F4)** — count findings on clean fixtures as FPs, add FP-budget + recall assertions, validate severity/CWE. Without this, none of the above regressions are catchable in CI. Do it right after 1-2 so the FP improvements are measured.
4. **Tighten the NoSQL sink (F3)** — require a model/collection receiver or reject callback-only arguments.
5. **Scope the secret exclusion lists to the value (F6)** — apply exclusions to the captured key/value, drop generic English words. Fixes silent secret FNs.
6. **Add a line-length / minified-file guard (F7)** — truncate long lines and detect single-line bundles in both regex passes.
7. **Revisit `MAX_PER_RULE` (F8)** — exempt critical security rules or cap per file; make overflow visible.
