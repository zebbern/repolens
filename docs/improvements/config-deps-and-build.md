# Config, Dependencies, Build & Tooling — Improvement Notes

_Runtime config is careful and mostly correct; the gaps are in tooling discipline (no lint, no CI), committed junk artifacts, and version/doc drift. Severity legend: **critical** (breaks prod / security) · **high** (real gap, fix soon) · **medium** (should fix) · **low** (cosmetic / minor)._

## Overall assessment

The build and runtime configuration shows genuine care in the places that matter: the CSP in `next.config.mjs` is explicit and thoroughly commented, the Turbopack browser aliases stubbing out web-tree-sitter's Node code paths (`fs`, `fs/promises`, `path`, `url`, `module` → `lib/stubs/empty.js`, which exists) are a legitimate fix, `vitest.config.ts` correctly forces the Node build of `fflate` for jsdom, and the pnpm override flooring `dompurify` to a patched release is sound supply-chain hardening. TypeScript is strict.

The weaknesses are all in tooling discipline, not runtime correctness. There is **no working lint** (the `lint` script points at an ESLint that isn't installed and has no config), **no CI at all** (no `.github/` directory), stale multi-hundred-KB test-output files are committed and leak the developer's absolute paths, the framework version disagrees three ways across README/AGENTS/package.json, and the dependency stack leans on beta/fresh majors with open-ended override floors and no engine/packageManager pin. None of this breaks the app, but the quality gates a 61k-LOC / 231-test-file project should have are largely absent. No critical issues survived verification.

## Findings

### [HIGH] `lint` script is broken — ESLint is neither installed nor configured

- **Where:** `package.json:9` (`"lint": "eslint ."`); no `eslint` / `eslint-config-next` in `package.json:87-109`; no `node_modules/.bin/eslint`; no `eslint.config.*` or `.eslintrc*` anywhere.
- **Problem:** Running `pnpm lint` fails immediately with command-not-found. There is no flat config and no legacy config. Note that Next 16 also dropped the built-in `next lint`, so `next build` does not run ESLint either — nothing lints this codebase.
- **Impact:** Zero lint enforcement across ~61k LOC: no `no-unused-vars`, `no-explicit-any`, react-hooks `exhaustive-deps`, a11y, or Next-specific rules. Contributors reasonably assume `pnpm lint` works; it silently does nothing. Lint regressions land undetected.
- **Recommendation:** Install `eslint` + `eslint-config-next` (or a flat-config equivalent), add an `eslint.config.mjs`, and wire it into CI. If linting is deliberately out of scope, at minimum delete the misleading script so it doesn't imply a gate that doesn't exist.
- **Effort:** S · **Confidence:** high

### [MEDIUM] No CI pipeline — tests, typecheck, and lint never run automatically

- **Where:** repo root — no `.github/` directory exists (verified: `.github` is absent entirely); no GitLab/Circle/Azure config either.
- **Problem:** Nothing runs the 231 test files, `tsc --noEmit`, `vitest`, or Playwright on push/PR. The vitest coverage thresholds configured in `vitest.config.ts:54-59` (statements 35 / branches 20 / functions 20 / lines 35) are therefore never enforced by any automation.
- **Impact:** On a fast-moving beta stack (next-auth 5 beta, Next 16.2, ai v6), type/test regressions land undetected until someone happens to run commands locally. There is no gate protecting the default branch.
- **Recommendation:** Add a GitHub Actions workflow (`pnpm install --frozen-lockfile`, then `tsc --noEmit`, `vitest run`, and — once fixed — `eslint`) on PRs. Run Playwright on a schedule or a `[e2e]`-labeled subset to keep PR latency reasonable.
- **Effort:** M · **Confidence:** high

### [MEDIUM] Large stale test-output artifacts committed to git, leaking local absolute paths

- **Where:** `playwright-output.txt` (323 KB), `tsc-output.txt` (~20 KB), `pw-out.txt` (~0.4 KB) are all tracked; `.gitignore:36-42`.
- **Problem:** `git ls-files` confirms all three are tracked. `playwright-output.txt` is actually stale *vitest* failure output (it opens with "Vitest cannot be imported in a CommonJS module") and contains ~500 occurrences of the maintainer's absolute local checkout path (`C:\Users\<username>\...\workproject\...`), exposing the developer's username and full local filesystem layout. `.gitignore` ignores `test-output*.txt` / `build-output.txt` but not these exact filenames, so they slipped through.
- **Impact:** Repo bloat, misleading stale output baked into history, and information disclosure (username + directory tree). I grepped all three for tokens/keys and found **none** — but the pattern is fragile: a future paste of a run containing a PAT or API key would be committed the same way.
- **Recommendation:** `git rm --cached playwright-output.txt tsc-output.txt pw-out.txt`, then broaden `.gitignore` to a general pattern such as `*-output.txt` and `pw-out.txt` (or route all such dumps into an ignored `_artifacts/` directory). If the path/username disclosure matters, scrub them from history (e.g. `git filter-repo`).
- **Effort:** S · **Confidence:** high

### [MEDIUM] Heavy reliance on beta/fresh deps with open-ended overrides and no engine/packageManager pin

- **Where:** `package.json:57` (`ai: "^6.0.158"`), `:68` (`next: "16.2.3"`), `:69` (`next-auth: "5.0.0-beta.30"`), `:85` (`zod: "^4.0.0"`), `:106` (`tailwindcss: "^4.2.2"`), `:110-114` (pnpm overrides); no `engines` or `packageManager` field anywhere.
- **Problem:** A beta dependency (`next-auth` 5.0.0-beta.30) gates all authentication, alongside recent majors (`ai` v6, `next` 16.2, `zod` v4, `tailwindcss` v4) mostly on caret ranges. The pnpm overrides use unbounded floors — `dompurify: ">=3.3.2"` and `lodash-es: ">=4.18.1"` — which permit silent major bumps. There is no Node `engines` constraint and no `packageManager` field despite the project clearly using pnpm.
- **Impact:** Reproducibility and stability risk. The lockfile pins current resolutions, but any non-`--frozen-lockfile` install (or a `pnpm update`) can resolve a different tree; the `>=` overrides can pull `dompurify` or `lodash-es` across a major, potentially breaking Mermaid's sanitized rendering or reintroducing a sanitizer regression. `next-auth` betas can ship breaking changes between beta numbers. Auth and diagram sanitization are both security-adjacent surfaces, which raises the stakes.
- **Recommendation:** Bound the overrides (`dompurify: ">=3.3.2 <4"`, `lodash-es: ">=4.18.1 <5"`). Pin `next-auth` to the exact beta (drop nothing — it already has no caret, but track its changelog deliberately). Add `"engines": { "node": ">=20" }` and a `"packageManager": "pnpm@<version>"` field. Ensure CI uses `pnpm install --frozen-lockfile`.
- **Effort:** M · **Confidence:** medium

### [LOW] Framework version disagrees three ways; no `typecheck` script

- **Where:** `README.md:135` ("Next.js 15"), `AGENTS.md:11` ("Next.js … 16.1.6"), `package.json:68` (`next: "16.2.3"`); no `typecheck` script in `package.json` scripts (`:6-17`).
- **Problem:** Three documents state three different core-framework versions. Separately, the project docs claim "typecheck currently passes clean," but there is no `typecheck` script — the only way to run it is invoking `tsc --noEmit` manually, and `build` (`rimraf .next && next build`) relies on Next's build-time check rather than a discoverable standalone command.
- **Impact:** Contributors get contradictory information about the framework version and have no obvious command for the type-check gate the docs reference. Drift like this signals docs aren't maintained alongside deps.
- **Recommendation:** Single-source the version (update README/AGENTS, or generate the stack table from `package.json`). Add `"typecheck": "tsc --noEmit"` to scripts so the claimed gate is runnable and CI-wireable.
- **Effort:** S · **Confidence:** high

### [LOW] `images.unoptimized` globally negates `remotePatterns`; dated tsconfig target

- **Where:** `next.config.mjs:4-12` (`unoptimized: true` alongside a `remotePatterns` entry for `avatars.githubusercontent.com`); `tsconfig.json:9` (`"target": "ES6"`).
- **Problem:** `images.unoptimized: true` disables the Next Image optimizer app-wide, making the configured `remotePatterns` dead config that misleads readers into thinking optimization is active. Separately, `target: "ES6"` (ES2015) is dated for a React 19 / Next 16 app; it mainly affects type-checking lib surface since SWC/Turbopack controls actual emit.
- **Impact:** Low. Avatars load unoptimized (bandwidth), and the inert `remotePatterns` is a small documentation trap. The ES6 target is largely cosmetic given SWC handles transpilation, but can subtly narrow available lib typings.
- **Recommendation:** Either drop `unoptimized` (if optimization is wanted) or remove the now-inert `remotePatterns`. Bump `tsconfig` `target` to `ES2022` to match the runtime.
- **Effort:** S · **Confidence:** medium

## Suggested order of work

1. **Fix the lint gate** (HIGH) — install + configure ESLint, or delete the broken script. Everything else quality-wise builds on having a working lint.
2. **Remove committed artifacts + tighten `.gitignore`** (MEDIUM) — `git rm --cached` the three `*-output.txt` files and broaden the ignore pattern; scrub history if path disclosure matters.
3. **Add CI** (MEDIUM) — a single Actions workflow running `tsc --noEmit`, `vitest run`, and lint on PRs with `--frozen-lockfile`; this also enforces the existing coverage thresholds.
4. **Bound the pnpm overrides and add engine/packageManager pins** (MEDIUM) — `>=3.3.2 <4` etc., `engines.node`, `packageManager`.
5. **Reconcile version docs + add `typecheck` script** (LOW) — single-source the Next version, add `"typecheck": "tsc --noEmit"`.
6. **Config cleanup** (LOW) — resolve the `unoptimized`/`remotePatterns` contradiction and bump `tsconfig` target to `ES2022`.
