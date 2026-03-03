# Agent: browser-tester
## Purpose
Visually verify the Issues tab and Diagrams tab in a running dev server with a real repo loaded. Take screenshots and check for JS errors.

## Skills
Load before starting: testing-patterns

## Subtasks

### Setup
- [ ] Start the dev server (`pnpm dev`) and verify it is running (health check on localhost port)
- [ ] Load the app in the browser and enter a real GitHub repo URL (e.g., a small public repo)
- [ ] Wait for the repo to finish loading (code index populated)

### Issues tab verification
- [ ] Navigate to the Issues tab
- [ ] Verify the health grade badge renders (letter grade A–F with score out of 100)
- [ ] Verify scanned-files count and rules-evaluated count are displayed
- [ ] Verify severity summary badges render (Critical/Warning/Info counts) with correct color coding
- [ ] Verify category filter chips render (Security, Bad Practices, Reliability) with counts
- [ ] Click each severity badge — verify the issue list filters to show only that severity
- [ ] Click each category chip — verify the issue list filters to that category
- [ ] Click "All" — verify all issues are shown again
- [ ] Expand a file group — verify individual issues render with severity icon, title, and line number
- [ ] Expand an individual issue — verify description, code snippet, suggestion, and reference tags (CWE/OWASP) render
- [ ] Take a screenshot of the Issues tab with issues visible
- [ ] Check browser console for JS errors or warnings related to issues-panel

### Diagrams tab verification
- [ ] Navigate to the Diagrams tab
- [ ] Select "Summary" diagram type — verify it renders (project summary data)
- [ ] Take a screenshot of the Summary diagram
- [ ] Select "Topology" diagram type — verify Mermaid flowchart renders
- [ ] Take a screenshot of the Topology diagram
- [ ] Select "Import Graph" diagram type — verify Mermaid graph renders
- [ ] Take a screenshot of the Import Graph diagram
- [ ] Select "Class Diagram" diagram type — verify Mermaid classDiagram renders
- [ ] Take a screenshot of the Class Diagram
- [ ] Select "Entry Points" diagram type — verify it renders
- [ ] Take a screenshot of the Entry Points diagram
- [ ] Select "Module Usage" diagram type — verify it renders
- [ ] Take a screenshot of the Module Usage diagram
- [ ] Select "Treemap" diagram type — verify treemap visualization renders (colored blocks)
- [ ] Take a screenshot of the Treemap diagram
- [ ] Select "External Deps" diagram type — verify external dependencies diagram renders
- [ ] Take a screenshot of the External Deps diagram
- [ ] Select "Focus Diagram" diagram type — enter a focus target, verify focused subgraph renders
- [ ] Take a screenshot of the Focus Diagram
- [ ] Check browser console for JS errors or warnings related to diagram rendering

### Error and edge-case checks
- [ ] On the Diagrams tab, verify the loading spinner appears during diagram generation
- [ ] Verify zoom controls (zoom in, zoom out, reset) function without JS errors
- [ ] Check that switching diagram types rapidly does not cause rendering glitches or stale diagrams
- [ ] Collect and report all browser console errors/warnings found during the session

## Notes
- Diagrams map to these `DiagramType` values: summary, topology, imports, classes, entrypoints, modules, treemap, externals, focus
- Screenshots should be saved to `test-screenshots/` directory
- Report any visual defects (broken layout, missing data, unreadable text) as findings
- If any diagram type fails to render, note which type and the error message

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
