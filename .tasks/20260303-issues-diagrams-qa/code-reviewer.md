# Agent: code-reviewer
## Purpose
Review Issues panel, Diagram viewer, Mermaid renderer, and diagram-data module for correctness, error handling, edge cases, and UI robustness.

## Skills
Load before starting: none

## Subtasks

### `components/features/issues/issues-panel.tsx` (388 lines)
- [ ] Verify the severity filter logic: toggling `critical`, `warning`, `info` correctly filters `results.issues` by severity
- [ ] Verify the category filter logic: toggling `security`, `bad-practice`, `reliability` correctly filters by category
- [ ] Check the "All" filter reset: confirm clicking "All" shows all issues regardless of previous filter state
- [ ] Review the `useEffect` → `analyzeCodebase` flow: check for race conditions if `codeIndex` changes rapidly (timer is 50ms)
- [ ] Check the empty-state branches: `codeIndex.totalFiles === 0`, `results === null`, `filteredIssues.length === 0`, `summary.total === 0`
- [ ] Verify `ruleOverflow` display: confirm overflow notice renders correctly when `results.ruleOverflow.size > 0`
- [ ] Check the `onNavigateToFile` callback: confirm it only fires on line-number click, not on issue expand
- [ ] Review the auto-expand logic: groups auto-expand when `groupedByFile.size <= 5`, verify toggle still works correctly in that state

### `components/features/diagrams/diagram-viewer.tsx` (664 lines)
- [ ] Check error handling when `generateDiagram` returns unexpected data or throws
- [ ] Verify all 9 diagram types are handled in the viewer's rendering logic (summary, topology, imports, classes, entrypoints, modules, treemap, externals, focus)
- [ ] Review the focus-diagram UX: verify `focusTarget` and `focusHops` are passed through correctly
- [ ] Check loading state management: verify spinner shows during analysis computation and clears on completion
- [ ] Review zoom/pan controls: verify `ZoomIn`, `ZoomOut`, `RotateCcw` handlers exist and function
- [ ] Check export/download functionality: verify SVG element access via `MermaidDiagramHandle` ref

### `components/features/diagrams/mermaid-diagram.tsx` (131 lines)
- [ ] Verify error state: check that mermaid parse/render errors are caught and displayed to the user (not silently swallowed)
- [ ] Check the `renderIdRef` stale-render guard: verify rapid chart changes don't cause glitched renders
- [ ] Verify `securityLevel: 'strict'` is set in mermaid config (prevents XSS in diagram labels)
- [ ] Check empty chart handling: verify `chart.trim()` guard prevents rendering empty strings
- [ ] Review `onNodeClick` callback: verify click handler is attached to rendered SVG nodes

### `lib/diagrams/diagram-data.ts` (re-export shim)
- [ ] Verify all expected exports are re-exported: `types`, `helpers`, `generators`
- [ ] Confirm no logic lives in this file — it should be a pure re-export barrel

### Cross-cutting concerns
- [ ] Check for any unhandled promise rejections (mermaid.render is async)
- [ ] Review accessibility: verify interactive elements (buttons, expandable sections) have appropriate semantics
- [ ] Check for potential memory leaks: verify `useEffect` cleanup functions exist where needed

## Notes
- This is a read-only review. Do not modify source files.
- Report findings using severity levels: S0 (blocker), S1 (significant), S2 (minor/suggestion).
- Focus on correctness and error handling over style preferences.

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
