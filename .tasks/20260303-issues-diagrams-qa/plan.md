# Plan: Issues Tab + Diagrams QA

## Overview
Validate the Issues scanner and Diagrams feature areas through unit tests, code review, and browser testing. Phase 1 runs tester and code-reviewer in parallel (no dependencies). Phase 2 uses browser-tester to verify end-to-end rendering. Phase 3 applies targeted fixes for any discovered issues.

## Architecture Decisions
| Decision | Alternatives | Rationale |
|----------|-------------|----------|
| Parallel tester + code-reviewer (Phase 1) | Sequential | No dependency between unit tests and static code review — parallel saves time |
| Browser testing after unit tests | Browser-first | Unit tests catch logic bugs faster; browser testing verifies rendering and integration on a known-good codebase |
| Single error-fixer pass at end | Fix-as-you-go | Batching fixes avoids conflicting edits; fixer sees all findings at once |

## Affected Files
| Action | File Path | Change Description |
|--------|-----------|-------------------|
| TEST | lib/code/scanner/scanner.test.ts | Add edge-case tests for empty input, no-issues scenarios |
| TEST | lib/code/scanner/rules.test.ts | Existing — verify pass/fail |
| TEST | lib/code/scanner/rules-composite.test.ts | Existing — verify pass/fail |
| TEST | lib/code/scanner/structural-scanner.test.ts | Existing — verify pass/fail |
| TEST | lib/diagrams/generators/*.test.ts (9 files) | Add edge-case tests for empty/minimal data |
| TEST | lib/diagrams/generators/index.test.ts | Add dispatch edge-case tests |
| TEST | lib/diagrams/helpers.test.ts | Existing — verify pass/fail |
| REVIEW | components/features/issues/issues-panel.tsx | Code review for correctness, error handling, UI |
| REVIEW | components/features/diagrams/diagram-viewer.tsx | Code review for correctness, error handling, UI |
| REVIEW | components/features/diagrams/mermaid-diagram.tsx | Code review for error handling, render edge cases |
| REVIEW | lib/diagrams/diagram-data.ts | Code review — re-export shim correctness |
| MAYBE-MODIFY | Any of the above | error-fixer may apply targeted fixes |

## Phases
| Phase | Agents | Purpose | Depends On |
|-------|--------|---------|------------|
| 1 | tester, code-reviewer | Run unit tests + add edge cases; static code review | — |
| 2 | browser-tester | End-to-end visual + console validation | Phase 1 |
| 3 | error-fixer | Fix discovered bugs, re-run tests | Phase 2 |

## Dependencies
- browser-tester needs Phase 1 complete so it tests a codebase with known test status
- error-fixer needs all findings from tester, code-reviewer, and browser-tester before starting

## Risk Assessment
- **Mermaid rendering failures**: Diagram syntax errors may crash the mermaid-diagram component. The component has error state handling, but edge cases with empty charts could slip through.
- **Scanner performance on large repos**: Not a QA risk here, but scanner tests with many rules could be slow. Mitigated by existing `MAX_PER_RULE` cap.
- **Browser-tester flakiness**: Dev server startup timing and real repo loading can be flaky. Mitigated by health checks and retries.
