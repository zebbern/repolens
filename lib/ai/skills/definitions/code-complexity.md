---
id: code-complexity
name: Code Complexity
description: Identify tech debt, god functions, deep nesting, high coupling, dead code, and code duplication patterns
trigger: When asked about code quality, tech debt, complexity, maintainability, or refactoring candidates
relatedTools:
  - analyzeImports
  - readFile
  - searchFiles
  - getProjectOverview
---

## Purpose

Performs a systematic tech debt and complexity assessment of the codebase by measuring function size, nesting depth, module coupling, code duplication, and dead code. The analysis applies quantitative thresholds to classify findings by severity — distinguishing genuine maintainability risks from acceptable complexity. The user receives a prioritized list of refactoring candidates with exact locations, measured metrics, and concrete refactoring strategies.

## Prerequisites

Ensure the `analyzeImports` and `getProjectOverview` tools are available before proceeding. If `analyzeImports` is unavailable, fall back to `searchFiles` for import pattern analysis. The `readFile` tool is required for detailed function-level analysis.

## Methodology

Follow this structured approach for complexity analysis. Complete each phase in order.

### Phase 1: Project Structure Assessment

1. Call `getProjectOverview` to understand the project scope and tech stack
2. Identify the directory structure convention (feature-based, layer-based, hybrid)
3. Note the total file count and module boundaries
4. Read key configuration files to understand build and lint rules already in place
5. Identify any existing complexity tooling (ESLint complexity rules, SonarQube, etc.)

### Phase 2: Function Complexity Analysis

1. Use `searchFiles` to locate the largest and most complex files:
   - Search for long function bodies by identifying function declarations
   - Search for deep nesting: multiple levels of `if`, `for`, `switch`, `try` nesting
2. Read the flagged files with `readFile` and measure:
   - **Function length**: Count lines per function
   - **Nesting depth**: Count maximum indentation levels within a function
   - **Parameter count**: Count function parameters
   - **Return complexity**: Count distinct return statements and return types
3. Identify god functions — functions that handle multiple unrelated responsibilities

**Quantitative Thresholds**

| Metric | Threshold | Classification |
|--------|-----------|---------------|
| Function length | > 150 lines | God function — split immediately |
| Function length | 80-150 lines | Complex — refactoring candidate |
| Function length | 40-80 lines | Monitor for growth |
| Function length | < 40 lines | Healthy |
| Nesting depth | > 6 levels | Critical — flatten or extract |
| Nesting depth | 5-6 levels | High — refactoring candidate |
| Nesting depth | 4 levels | Moderate — review |
| Nesting depth | < 4 levels | Healthy |
| Parameter count | > 7 | Extract to options object |
| Parameter count | 5-7 | Review for grouping |
| Parameter count | < 5 | Healthy |

**Verification**: Before flagging a long function, check if it contains a single large data structure (lookup table, config object, switch with many cases) — these are often acceptable in their current form.

### Phase 3: Module Coupling Analysis

1. Use `analyzeImports` on key files to map dependency relationships
2. For each major module, measure:
   - **Fan-out**: How many other modules does it import from?
   - **Fan-in**: How many modules import from it?
   - **Import depth**: How far across the dependency tree does it reach?
3. Identify circular dependencies by tracing import chains
4. Look for modules that import from too many unrelated sources (high fan-out = fragile)

**Quantitative Thresholds**

| Metric | Threshold | Classification |
|--------|-----------|---------------|
| Direct imports from a file | > 15 | High coupling — refactoring candidate |
| Direct imports from a file | 10-15 | Elevated — monitor |
| Direct imports from a file | < 10 | Healthy |
| Circular dependency chain | Any cycle | Always flag |
| Modules importing from a single file (fan-in) | > 25 | Potential god module |
| Modules importing from a single file (fan-in) | 15-25 | Central module — review scope |
| Modules importing from a single file (fan-in) | < 15 | Healthy |

### Phase 4: Code Duplication Analysis

1. Use `searchFiles` to find similar patterns across files:
   - Repeated error handling blocks
   - Duplicated validation logic
   - Copy-pasted API call patterns with slight variations
   - Similar component structures with different data
2. Identify the duplication type:
   - **Exact duplication**: Identical code blocks in multiple files
   - **Structural duplication**: Same pattern with different variable names
   - **Semantic duplication**: Different code achieving the same purpose

**Verification**: Before flagging duplication, confirm the similar code serves the same purpose. Two functions that look similar but handle different edge cases may be intentionally separate.

### Phase 5: Dead Code Detection

1. Use `searchFiles` to find exported symbols
2. Use `analyzeImports` or `searchFiles` to check if those exports are imported anywhere
3. Check for:
   - Exported functions/types with zero importers (dead exports)
   - Commented-out code blocks (> 10 lines)
   - Unreachable code after early returns or throws
   - Feature flags for features that shipped long ago
   - Unused dependencies in `package.json`
4. Search for TODO/FIXME/HACK comments that indicate acknowledged debt

**Verification**: Before flagging a dead export, confirm it's not:
- Used dynamically (e.g., `require(variable)`, route-based loading)
- Part of a public API consumed by external packages
- Referenced in test files (test utilities are valid consumers)

### Phase 6: Report

For each finding, report:
1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Function Complexity, Coupling, Duplication, or Dead Code
3. **Location**: Exact file path and line reference
4. **Description**: What the complexity issue is
5. **Metric**: The measured value and which threshold it exceeds
6. **Impact**: How this affects maintainability, testability, or developer velocity
7. **Refactoring Strategy**: Specific approach to reduce complexity

Provide an overall summary:
- Total findings by severity and category
- Tech debt heat map: which directories have the most findings
- Top 3 highest-impact refactoring targets
- Quick wins (simple extractions or dead code removal)
- Positive patterns: well-structured modules worth preserving

## Severity Classification

| Severity | Criteria | Example |
|----------|----------|---------|
| **Critical** | Circular dependency causing runtime issues, god function > 150 lines on critical path | 200-line `processPayment` function with 7 levels of nesting |
| **High** | God function > 150 lines, file > 800 lines, fan-out > 15 imports | `api-client.ts` importing from 18 different modules |
| **Medium** | Complex function (80-150 lines), deep nesting (> 4 levels), significant duplication | Same 30-line error handling block in 5 API route handlers |
| **Low** | Minor duplication, moderate coupling, dead export | Unused exported type in a utility module |
| **Informational** | Style suggestions, organizational improvements | Functions could be grouped by domain for better readability |

## Example Output

```
### Finding: God Function — `lib/changelog/generate.ts` → `generateChangelog`

- **Severity**: High
- **Category**: Function Complexity
- **Location**: `lib/changelog/generate.ts` lines 45-210
- **Metric**: 165 lines, 6 levels of nesting, 8 parameters
- **Description**: The `generateChangelog` function handles commit parsing, category classification, markdown formatting, date range filtering, and version comparison in a single function body. It has 12 distinct return paths and mixes data transformation with string formatting.
- **Impact**: Any change to changelog generation requires understanding all 165 lines. Testing individual behaviors (e.g., category classification) requires setting up the full function context. Bug surface area is high.
- **Refactoring Strategy**: Extract into focused helpers:
  ```ts
  // Before: one 165-line function
  function generateChangelog(commits, from, to, format, ...) { ... }

  // After: composed from focused functions
  function generateChangelog(options: ChangelogOptions) {
    const filtered = filterCommitsByDateRange(options.commits, options.from, options.to);
    const categorized = categorizeCommits(filtered);
    return formatChangelog(categorized, options.format);
  }
  ```
```

## Common False Positives

Skip or downgrade these patterns — they look complex but are acceptable:

1. **Generated code**: Files generated by code generators, ORMs, or schema tools (e.g., Prisma client, GraphQL codegen) are auto-maintained and should not be refactored manually
2. **Configuration files**: Large config objects in `tailwind.config.ts`, `next.config.mjs`, or similar are declarative, not procedural — their length is not a complexity concern
3. **Test utilities with intentional complexity**: Test factories, fixtures, and helpers that set up complex scenarios are deliberately detailed — they trade internal complexity for test readability
4. **Switch statements with many cases**: A `switch` with 15+ cases for handling distinct enum values or message types is often the clearest representation. Only flag if cases contain significant logic (> 5 lines each)
5. **Type definition files**: Large `.d.ts` or type-heavy files are declarative. A 500-line types file is categorically different from a 500-line logic file

## Related Skills

- For architectural context on coupling patterns and module boundaries, load `architecture-analysis`
- For performance implications of complex code paths, load `performance-analysis`
- For identifying which complex files change most often (prioritize refactoring), load `git-analysis`
