# Agent: tester
## Purpose
Run all existing unit tests for Issues scanner and Diagrams generators. Add missing edge-case tests.

## Skills
Load before starting: testing-patterns

## Subtasks

### Existing test suite — run and report
- [ ] Run `pnpm vitest run lib/code/scanner/scanner.test.ts` and report pass/fail with counts
- [ ] Run `pnpm vitest run lib/code/scanner/rules.test.ts` and report pass/fail with counts
- [ ] Run `pnpm vitest run lib/code/scanner/rules-composite.test.ts` and report pass/fail with counts
- [ ] Run `pnpm vitest run lib/code/scanner/structural-scanner.test.ts` and report pass/fail with counts
- [ ] Run `pnpm vitest run lib/diagrams/generators/` to run all 9 generator test files + index.test.ts, report pass/fail
- [ ] Run `pnpm vitest run lib/diagrams/helpers.test.ts` and report pass/fail with counts

### Scanner edge-case tests — add to `scanner.test.ts`
- [ ] Add test: `scanIssues` with a CodeIndex containing one file that has empty string content (0 lines) — verify it returns valid ScanResults with 0 issues and healthScore 100
- [ ] Add test: `scanIssues` with a CodeIndex containing multiple clean files (no rule violations) — verify summary counts are all 0 and grade is A
- [ ] Add test: `scanIssues` with a CodeIndex containing only non-JS/TS files (e.g., `.md`, `.json`) — verify language-specific rules are skipped and no false positives

### Diagram generator edge-case tests — add missing empty/minimal cases
- [ ] Review each of the 9 generator test files: verify each has a test for `createEmptyAnalysis()` input. Add the test if missing (generator should return valid result without crashing)
- [ ] Review each of the 9 generator test files: verify each has a test for `createMinimalAnalysis()` input. Add the test if missing
- [ ] Add test in `index.test.ts`: call `generateDiagram` with each of the 9 `DiagramType` values using `createEmptyAnalysis()` — verify none throw and all return a result with the correct `type` field

### Re-run full suite
- [ ] Run `pnpm vitest run lib/code/scanner/ lib/diagrams/` to confirm all tests (existing + new) pass

## Notes
- Test fixtures for diagrams are in `lib/diagrams/__fixtures__/mock-analysis.ts` — use `createEmptyAnalysis()`, `createMinimalAnalysis()`, and `createRealisticAnalysis()`
- For scanner tests, use `createEmptyIndex()` and `indexFile()` from `@/lib/code/code-index`
- The `scanIssues` function accepts `(codeIndex, analysis)` where `analysis` can be `null`
- Existing `scanner.test.ts` already has an "handles empty index" test. The new tests target non-empty indexes with edge-case content.
- The `generateDiagram` dispatcher in `generators/index.ts` falls back to `generateProjectSummary` for unrecognized types (already tested)

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
