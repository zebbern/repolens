---
id: tour-creation
name: Tour Creation
description: Guided code tour generation with flow-based stop ordering, annotated explanations (What/Why/How/Connection), and quality verification. Creates walkthroughs for features, architecture, and onboarding.
trigger: When asked to create a code tour, walkthrough, guided explanation of a codebase feature or flow
relatedTools:
  - generateTour
  - readFile
  - readFiles
---

## Purpose

Creates structured guided tours through a codebase that explain features, flows, or architectural patterns stop-by-stop. Each tour follows a logical path through the code with annotations explaining what the code does, why it matters, and how stops connect. The user receives a navigable walkthrough that enables onboarding, knowledge transfer, or code review — with accurate file references verified against the current codebase state.

## Prerequisites

Ensure the `generateTour` tool is available before proceeding. If not available, produce a structured markdown walkthrough with file references instead. The `searchFiles` tool is needed for locating relevant files. Use `readFiles` for batch reading (up to 10 files).

**Error Recovery**: If a file path from planning is invalid (file moved or renamed), use `searchFiles` to find the current location by searching for a unique function name or class from the original file.

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

**Cross-Cutting Concern Guidance**: For flows that span multiple features (e.g., auth + data fetching + rendering), keep the tour focused on the primary path. Create separate tours for orthogonal concerns rather than mixing them into one sprawling tour.

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

Each stop's annotation must include all 4 parts:

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

## Example Annotation

```
### Stop 3: Authentication Middleware — `middleware.ts` lines 12-34

**What**: This middleware intercepts every request and checks for a valid session token before allowing access to protected routes.

**Why**: Centralizing auth checks in middleware ensures no route accidentally skips authentication. The matcher pattern on line 28 defines which paths are protected, so public routes like `/api/auth/login` and `/` are excluded.

**How**: The `getSession()` call on line 15 reads the encrypted cookie, validates the JWT signature, and returns the user payload. Notice that `NextResponse.next()` on line 20 adds the `x-user-id` header — downstream API routes read this instead of re-validating the token, avoiding redundant crypto operations.

**Connection**: The previous stop showed how the login form submits credentials. This middleware is what enforces the session created by that login. The next stop shows how an API route reads the `x-user-id` header set here.
```

## Common False Positives & Pitfalls

Avoid these mistakes that frequently produce low-quality tours:

1. **Pointing to generated/bundled code**: Never reference files in `node_modules/`, `.next/`, `dist/`, or `build/` — these are generated and will confuse readers. Always point to source files
2. **Stale line references after refactoring**: If the codebase changed since you last read a file, re-read it before generating the tour. Line numbers shift when code is added or removed
3. **Including too much boilerplate**: Don't create stops for standard framework boilerplate (e.g., `layout.tsx` that just wraps children in providers) unless it's architecturally significant
4. **Hallucinated identifiers**: Always verify that variable names, function names, and type names in annotations match the actual code. Re-read the file if uncertain
5. **Tour scope creep**: A tour about "how authentication works" should not detour into database schema design. Keep each tour focused on its stated topic

## Related Skills

- For architecture context when designing tours about system structure, load `architecture-analysis`
- For identifying the most important files to tour (based on change frequency), load `git-analysis`
