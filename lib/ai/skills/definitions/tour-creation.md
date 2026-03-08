---
id: tour-creation
name: Tour Creation
description: Best practices for creating guided code tours with well-ordered stops and clear annotations
trigger: When asked to create a code tour, walkthrough, guided explanation of a codebase feature or flow
relatedTools:
  - generateTour
  - readFile
  - readFiles
---

## Prerequisites

Ensure the `generateTour` tool is available before proceeding. If not available, produce a structured markdown walkthrough with file references instead.

## Methodology

Follow this structured approach for creating effective code tours.

### Phase 1: Understand the Target

1. Clarify the tour's scope — what flow, feature, or concept should it cover?
2. Use `searchFiles` to locate relevant files for the topic
3. Read the key entry point files with `readFiles` (batch up to 10)
4. Trace the execution flow from entry to completion

### Phase 2: Plan the Tour Route

Design a logical path through the code:

**Flow-Based Ordering** (preferred for features and data flows)
- Start at the user-facing entry point (UI component, API route, CLI command)
- Follow the execution path step by step
- End at the final output or side effect

**Layered Ordering** (preferred for architecture overviews)
- Start at the highest abstraction layer
- Drill into implementation details progressively
- Show how layers connect

**Concept-Based Ordering** (preferred for pattern explanations)
- Start with the simplest example of the pattern
- Build complexity gradually
- Show variations and edge cases

### Phase 3: Select Stops

For each stop in the tour:

**Location Selection**
- Point to the exact file and line range where the relevant code lives
- Prefer function/class declarations over individual lines
- Include enough context (imports, surrounding code) but not entire files
- Aim for 5-20 line ranges per stop

**Stop Count Guidelines**
- Simple features: 5-8 stops
- Medium features: 8-15 stops
- Complex flows: 15-25 stops
- Never exceed 30 stops — split into multiple tours instead

### Phase 4: Write Annotations

Each stop's annotation should:

**Structure**
1. **What**: One sentence explaining what this code does
2. **Why**: Why this approach was chosen or why it matters
3. **How**: Key implementation details worth noting
4. **Connection**: How this connects to the previous and next stops

**Writing Guidelines**
- Use present tense: "This function validates..." not "This function will validate..."
- Reference specific variable names, function names, and types from the code
- Explain non-obvious patterns or conventions
- Include "notice that..." callouts for subtle but important details
- Use inline code formatting for identifiers: `functionName`, `VariableType`

**Annotation Length**
- Keep annotations between 50-200 words per stop
- Front-load the most important information
- Use bullet points for multiple observations at a single stop

### Phase 5: Generate the Tour

1. Call `generateTour` with the planned stops, a clear title, and optional theme
2. Verify the generated tour covers the complete flow
3. Check that file paths and line ranges are accurate by re-reading key files
4. Ensure annotations reference actual code (not hallucinated names)

### Phase 6: Quality Checks

Before delivering the tour:

- [ ] Every stop references a real file and valid line range
- [ ] Annotations match the actual code at each stop
- [ ] The tour tells a coherent story from start to finish
- [ ] No critical steps in the flow are skipped
- [ ] Annotations explain WHY, not just WHAT
- [ ] Technical terms are explained on first use
- [ ] The tour is self-contained — a reader can follow it without prior context
