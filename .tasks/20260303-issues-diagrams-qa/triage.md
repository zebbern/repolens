# Triage: Issues Tab + Diagrams QA

## EXECUTION_PLAN

| Order | Agent | Task Summary |
|-------|-------|-------------|
| 1a | tester | Run all existing unit tests for Issues scanner and Diagrams generators. Report pass/fail. Add missing edge-case tests for: scanner with empty file input, scanner with no issues found, each diagram generator with empty/minimal repo data, and diagram generator index dispatch. |
| 1b | code-reviewer | Review `components/features/issues/issues-panel.tsx`, `components/features/diagrams/diagram-viewer.tsx`, `components/features/diagrams/mermaid-diagram.tsx`, and `lib/diagrams/diagram-data.ts` for correctness, error handling, edge cases, and UI robustness. Check severity/category filters in Issues panel. |
| 2 | browser-tester | Start dev server. Load a real repo. Navigate to Issues tab — verify scanned issues with severity badges, categories, descriptions. Test filters. Navigate to Diagrams tab — cycle through all 9 diagram types (class-diagram, entry-points, external-deps, focus-diagram, import-graph, module-usage, summary, topology, treemap). Take screenshots of each. Check browser console for JS errors. |
| 3 | error-fixer | Fix any bugs discovered in steps 1a, 1b, or 2. Apply minimal targeted fixes. Re-run affected tests. |

## Complexity
Moderate
