# Agent: error-fixer
## Purpose
Fix bugs discovered by tester, code-reviewer, and browser-tester. Apply minimal targeted fixes and re-run affected tests.

## Skills
Load before starting: testing-patterns

## Subtasks

### Gather findings
- [ ] Read `.tasks/20260303-issues-diagrams-qa/tester.md` — note any failing tests or test errors
- [ ] Read `.tasks/20260303-issues-diagrams-qa/code-reviewer.md` — note any S0 or S1 findings
- [ ] Read `.tasks/20260303-issues-diagrams-qa/browser-tester.md` — note any JS errors, rendering failures, or visual defects

### Triage
- [ ] Create a prioritized list of bugs to fix (S0 blockers first, then S1 significant, then S2 if time permits)
- [ ] For each bug, identify the root-cause file and the minimal change needed

### Fix
- [ ] Apply each fix as a minimal, targeted change (do not refactor unrelated code)
- [ ] For each fix, verify the change does not break existing functionality by reviewing surrounding code

### Verify
- [ ] Re-run `pnpm vitest run lib/code/scanner/` — confirm all scanner tests pass
- [ ] Re-run `pnpm vitest run lib/diagrams/` — confirm all diagram tests pass
- [ ] If browser-tester reported JS errors, verify the fix resolves them (describe what was changed and why it resolves the error)

## Notes
- Only fix bugs that were actually reported by the Phase 1 and Phase 2 agents. Do not proactively hunt for new issues.
- If no bugs are found, report Status: COMPLETE with "No bugs to fix" and skip the Fix/Verify subtasks.
- Keep fixes minimal — one logical change per fix. Do not combine unrelated fixes into a single edit.
- If a fix requires a design decision (e.g., choosing between two valid approaches), document the decision in your RESULT block.

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
