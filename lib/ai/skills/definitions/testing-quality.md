---
id: testing-quality
name: Testing Quality
description: Assess test coverage completeness, test quality, missing edge cases, and testing best practices
trigger: When asked about test coverage, testing gaps, test quality, untested code, or testing strategy
relatedTools:
  - searchFiles
  - readFile
  - getProjectOverview
---

## Purpose

Answers "what's not tested?" and assesses the quality of existing tests by comparing source modules against test files, analyzing assertion quality, detecting flaky patterns, and identifying missing edge cases. The analysis applies quantitative thresholds to classify findings by severity — distinguishing critical coverage gaps from acceptable omissions. The user receives a prioritized list of untested code, weak tests, and missing edge cases with specific recommendations.

## Prerequisites

Ensure the `searchFiles` and `readFile` tools are available before proceeding. The `getProjectOverview` tool provides essential context for identifying the test framework, configuration, and project structure.

## Methodology

Follow this structured approach for testing quality analysis. Complete each phase in order.

### Phase 1: Test Infrastructure Assessment

1. Call `getProjectOverview` to understand the project structure
2. Identify the test framework and configuration:
   - Search for config files: `vitest.config.*`, `jest.config.*`, `playwright.config.*`
   - Read the config to understand test file patterns, coverage settings, and setup files
3. Check for test setup files (`test/setup.ts`, `setupTests.ts`, `global-setup.ts`)
4. Identify testing conventions:
   - Co-located tests (`component.test.tsx` next to `component.tsx`)
   - Separate test directories (`__tests__/`, `test/`, `e2e/`)
   - Naming patterns (`.test.`, `.spec.`, `test_`)
5. Note coverage configuration: thresholds, reporters, excluded paths

### Phase 2: Coverage Gap Analysis

1. Use `searchFiles` to build an inventory of source modules (`.ts`, `.tsx`, `.js`, `.jsx` files)
2. Use `searchFiles` to build an inventory of test files (`.test.*`, `.spec.*`, `__tests__/*`)
3. Match source files to their corresponding test files
4. Identify untested modules — source files with no matching test file

**Categorize untested modules by risk:**

| Module Type | Risk if Untested | Priority |
|-------------|-----------------|----------|
| Auth / security code | Critical — vulnerabilities go undetected | P0 — test immediately |
| API routes / handlers | High — contract changes break consumers silently | P1 — test soon |
| Business logic / hooks | High — core behavior unverified | P1 — test soon |
| UI components with logic | Medium — interactive bugs reach users | P2 — test next sprint |
| Utility / helper functions | Medium — shared code affects many callers | P2 — test next sprint |
| Layout / presentational components | Low — visual issues caught in review | P3 — test when convenient |
| Type definitions / constants | None — no runtime behavior | Skip |
| Re-export barrels / index files | None — no logic to test | Skip |

**Verification**: Before flagging a module as untested, check if it's tested indirectly through integration tests that exercise the module as part of a larger flow.

### Phase 3: Test Quality Analysis

For existing test files, read a representative sample (5-10 files) and assess:

**Assertion Quality**
1. Count assertions per test case — tests with zero assertions are meaningless
2. Check assertion specificity:
   - Weak: `expect(result).toBeDefined()`, `expect(result).toBeTruthy()`
   - Strong: `expect(result).toEqual({ id: 1, name: 'test' })`, `expect(fn).toHaveBeenCalledWith('arg')`
3. Look for tests that only verify happy paths without error scenarios

**Test Isolation**
1. Check for shared mutable state between tests (global variables, module-level state)
2. Look for test ordering dependencies (tests that fail when run individually)
3. Verify proper cleanup in `afterEach`/`afterAll` hooks
4. Check for hardcoded timeouts or `sleep` calls (flaky pattern)

**Mock Quality**
1. Look for over-mocking — mocking the system under test rather than its dependencies
2. Check for `as any` casts on mocks that hide type mismatches
3. Verify mocks match the actual API of the mocked module
4. Flag tests where mock setup exceeds test logic (> 60% of test is mock setup)

**Quantitative Thresholds**

| Metric | Threshold | Classification |
|--------|-----------|---------------|
| Test file with 0 assertions (any test case) | Always flag | Meaningless test |
| Test file with > 3 `any` casts | Flag for mock quality | Potential false coverage |
| Test case with > 10 lines of mock setup vs < 3 lines of assertions | Flag for over-mocking | Test may not verify real behavior |
| Test file using `setTimeout` / `sleep` for timing | Flag as flaky | Use `waitFor`, `findBy`, or event-driven patterns |
| Test case description starting with "should work" | Flag naming | Description should specify expected behavior |

### Phase 4: Edge Case Analysis

For tested modules, check if tests cover these common edge cases:

**Data Edge Cases**
- Empty inputs: empty strings, empty arrays, `null`, `undefined`
- Boundary values: 0, -1, MAX_SAFE_INTEGER, empty vs whitespace strings
- Invalid types: wrong data types if not caught by TypeScript at compile time
- Large inputs: arrays with 1000+ items, strings with 10000+ characters

**Error Path Edge Cases**
- Network failures: API timeouts, 500 errors, malformed responses
- Auth failures: expired tokens, missing permissions, invalid sessions
- Validation failures: missing required fields, format violations
- Concurrent operations: race conditions, stale data

**State Edge Cases**
- Loading states: component renders before data arrives
- Error states: component renders after failure
- Empty states: component renders with no data
- Stale state: component renders with outdated data after re-fetch

**Verification**: Don't flag missing edge cases on trivial functions (pure formatters, constant lookups). Focus on functions that handle user input, external data, or state transitions.

### Phase 5: Integration & E2E Gap Analysis

1. Check for integration tests that exercise cross-module interactions:
   - API route → service → database flow
   - User action → state change → UI re-render
   - Authentication flow end-to-end
2. Check for E2E tests (Playwright, Cypress) covering critical user journeys:
   - Login/logout flow
   - Core feature happy path
   - Error recovery (network failure, invalid input)
3. Identify orphaned test utilities — test helpers defined but never imported

**Quantitative Thresholds**

| Metric | Threshold | Classification |
|--------|-----------|---------------|
| API route with 0 integration tests | Flag if route handles mutations | Untested contract |
| Core user journey with 0 E2E tests | Always flag | Critical coverage gap |
| Component with > 5 interactive states and < 3 test cases | Flag as undertested | State coverage gap |
| Hook with side effects and 0 tests | Always flag | Unverified behavior |

### Phase 6: Report

For each finding, report:
1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Coverage Gap, Test Quality, Missing Edge Cases, or Integration Gap
3. **Location**: Source file (for coverage gaps) or test file (for quality issues)
4. **Description**: What the testing issue is
5. **Impact**: What risks are unmitigated by the missing or weak tests
6. **Recommendation**: Specific test to write or test to improve, with example

Provide an overall summary:
- Coverage: estimated percentage of modules with test files
- Quality: overall test quality assessment (strong, adequate, weak)
- Top 3 critical gaps to address first
- Quick wins: easy tests that would significantly improve confidence
- Positive patterns: well-tested modules worth using as templates

## Severity Classification

| Severity | Criteria | Example |
|----------|----------|---------|
| **Critical** | No tests for auth/security code, or tests with zero assertions on critical path | Auth middleware has a test file but no assertions — passes vacuously |
| **High** | Public API route untested, core business logic untested, tests with `any` casts hiding bugs | `use-changelog-engine.ts` — 300-line hook with complex state, no test file |
| **Medium** | Missing error path tests, insufficient edge cases on tested code | `fetchRepoData` tested for success but not for 401, 404, or network timeout |
| **Low** | Missing edge case for internal utility, presentational component untested | `formatDate` not tested with invalid date input |
| **Informational** | Test organization improvements, naming conventions | Test descriptions could be more specific about expected behavior |

## Example Output

```
### Finding: Critical Module Untested — `lib/auth/session.ts`

- **Severity**: Critical
- **Category**: Coverage Gap
- **Location**: `lib/auth/session.ts` (no corresponding test file found)
- **Description**: The session management module handles token validation, session creation, session refresh, and session revocation. It contains 4 exported functions and 120 lines of security-critical logic. No test file exists at `lib/auth/session.test.ts`, `lib/auth/__tests__/session.test.ts`, or any matching pattern.
- **Impact**: Bugs in session management could allow unauthorized access, session fixation, or token replay attacks. Without tests, regressions are undetectable until production.
- **Recommendation**: Create `lib/auth/session.test.ts` covering:
  ```ts
  describe('validateSession', () => {
    it('returns user payload for valid token', () => { ... });
    it('returns null for expired token', () => { ... });
    it('returns null for tampered token', () => { ... });
    it('returns null for missing token', () => { ... });
  });

  describe('refreshSession', () => {
    it('extends session for valid refresh token', () => { ... });
    it('rejects expired refresh token', () => { ... });
  });
  ```
```

## Common False Positives

Skip or downgrade these patterns — they don't need dedicated test files:

1. **Generated type definitions**: Files like `*.d.ts`, generated Prisma types, or GraphQL codegen output have no runtime behavior to test
2. **Re-export barrel files**: `index.ts` files that only re-export from other modules have no logic — the source modules should be tested, not the barrel
3. **Configuration files**: `tailwind.config.ts`, `next.config.mjs`, and similar are declarative configuration, not testable logic
4. **Third-party type stubs**: Type definition files for external libraries don't contain application logic
5. **Indirectly tested modules**: A utility function used exclusively by one tested hook may have adequate coverage through the hook's tests — verify before flagging as untested

## Related Skills

- For identifying which complex code most needs testing, load `code-complexity`
- For ensuring security-critical code has comprehensive tests, load `security-audit`
- For understanding which files change frequently (prioritize testing volatile code), load `git-analysis`
