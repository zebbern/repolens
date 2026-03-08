---
id: architecture-analysis
name: Architecture Analysis
description: Dependency mapping, layer identification, coupling/cohesion analysis with quantitative thresholds, and architecture diagram generation. Detects god modules, circular dependencies, and layer violations.
trigger: When asked to analyze architecture, map dependencies, identify layers, or generate architecture diagrams
relatedTools:
  - analyzeImports
  - getProjectOverview
  - generateDiagram
---

## Purpose

Performs a systematic architecture analysis of the codebase by mapping dependencies, identifying architectural layers, measuring coupling and cohesion, and detecting structural anti-patterns. The user receives quantified findings (not subjective opinions), actionable refactoring recommendations, and generated diagrams showing module relationships and data flow.

## Prerequisites

Ensure the `analyzeImports`, `getProjectOverview`, and `generateDiagram` tools are available before proceeding. If `generateDiagram` is unavailable, produce raw Mermaid syntax instead. The `searchFiles` tool is used for locating code patterns across the project.

## Methodology

Follow this structured approach for architecture analysis. Complete each phase in order.

### Phase 1: Project Overview

1. Call `getProjectOverview` to get high-level project statistics
2. Read the project's entry point files (e.g., `app/layout.tsx`, `src/main.ts`, `index.ts`)
3. Read configuration files (`tsconfig.json`, `next.config.*`, `vite.config.*`) to understand build setup
4. Identify the framework and architectural style (MVC, component-based, serverless, etc.)

### Phase 2: Layer Identification

Identify and document the architectural layers:

**Presentation Layer**
- Use `searchFiles` to find component directories and UI code
- Identify component patterns (atomic design, feature-based, route-based)
- Note any shared UI library or design system usage

**Application Layer**
- Locate business logic: hooks, services, controllers, use cases
- Identify state management approach (context, stores, server state)
- Map data fetching patterns (REST, GraphQL, server actions)

**Data Layer**
- Find data access code: repositories, models, ORM configurations
- Identify database connections and schemas
- Note caching strategies

**Infrastructure Layer**
- Locate middleware, authentication, logging, monitoring
- Identify external service integrations
- Note deployment configuration

### Phase 3: Dependency Mapping

1. Use `analyzeImports` on key files to trace dependency chains
2. Map module boundaries — which modules depend on which
3. Identify circular dependencies or unexpected cross-layer imports
4. Document the dependency direction (should flow: UI → Application → Data → Infrastructure)

For each major module:
- List its public API (what it exports)
- List its dependencies (what it imports)
- Identify its responsibility (single-sentence description)

### Phase 4: Diagram Generation

Generate diagrams to visualize the architecture:

**High-Level Architecture Diagram**
- Use `generateDiagram` with type `topology` for module relationships
- Show major modules as nodes, dependencies as edges
- Group by architectural layer

**Import Graph**
- Use `generateDiagram` with type `import-graph` for detailed import relationships
- Focus on the most connected modules

**Data Flow Diagram**
- Create a sequence diagram showing how data flows through a typical request
- Trace from user action → UI → API → data → response

### Phase 5: Quantitative Analysis

Measure the architecture against concrete thresholds. Before reporting a finding, verify the count by running `analyzeImports` or `searchFiles` to confirm.

**Coupling Analysis**

| Metric | Threshold | Classification |
|--------|-----------|---------------|
| Direct imports from a single module | >8 | High coupling |
| Direct imports from a single module | 5–8 | Moderate coupling |
| Direct imports from a single module | <5 | Healthy |

**Cohesion Analysis**

| Metric | Threshold | Classification |
|--------|-----------|---------------|
| Unrelated exports from a single module | >15 | Low cohesion — split module |
| Unrelated exports from a single module | 8–15 | Review for grouping |
| Unrelated exports from a single module | <8 | Healthy |

**God Module Detection**

| Metric | Threshold | Classification |
|--------|-----------|---------------|
| Files importing from a single module | >20 | God module candidate |
| Files importing from a single module | 10–20 | Monitor for growth |
| Files importing from a single module | <10 | Healthy |

**Dependency Direction**
- Do dependencies flow in the correct direction (UI → App → Data → Infra)?
- Are there dependency inversions where needed?
- Are infrastructure details leaking into business logic?

### Phase 6: Anti-Pattern Checklist

Check for these common architectural anti-patterns:

- [ ] **Circular dependencies**: Module A imports B, B imports A (or longer cycles)
- [ ] **Barrel file bloat**: `index.ts` re-exports that obscure dependency chains and bloat bundles
- [ ] **Prop drilling chains**: Props passed through >3 intermediate components unchanged
- [ ] **God components**: Components >300 lines mixing data fetching, state, and rendering
- [ ] **Layer violations**: UI code directly accessing database or infrastructure
- [ ] **Shared mutable state**: Global state modified from multiple unrelated modules
- [ ] **Dependency fan-out**: A single file importing from >10 different modules

### Phase 7: Report

Deliver:
1. Architecture overview with identified layers and their responsibilities
2. Module dependency map with import/export relationships
3. Generated diagrams (topology, import graph, data flow)
4. Quantified findings with severity classification (see table below)
5. Positive architectural decisions worth preserving

## Severity Classification

| Severity | Criteria | Example |
|----------|----------|---------|
| **Critical** | Circular dependency causing runtime errors, or layer violation enabling security bypass | Data layer directly imported in client components exposing DB credentials |
| **High** | God module (>20 importers), circular deps causing bundle bloat, missing layer boundary | `lib/utils.ts` imported by 35 files with 25 unrelated exports |
| **Medium** | High coupling (>8 imports from one module), prop drilling >3 levels | Every component imports directly from `lib/api/client.ts` |
| **Low** | Moderate coupling (5–8 imports), barrel files obscuring deps | `components/index.ts` re-exports 20 components |
| **Info** | Style preference, minor organizational improvement | Feature modules could be grouped by domain instead of type |

## Example Output

```
### Finding: God Module — `lib/utils.ts`

- **Severity**: High
- **Metric**: 28 files import from `lib/utils.ts`; module exports 19 functions across 4 unrelated domains (string formatting, date math, API helpers, validation)
- **Location**: `lib/utils.ts` (imported by files across `components/`, `app/`, `hooks/`, `lib/api/`)
- **Impact**: Any change to `lib/utils.ts` has a blast radius of 28 files. Testing, review, and refactoring are difficult because unrelated concerns are entangled.
- **Recommendation**: Split into domain-specific modules:
  - `lib/format.ts` — string and date formatting
  - `lib/validation.ts` — input validation helpers
  - `lib/api-helpers.ts` — API request/response utilities
  - Keep `lib/utils.ts` for truly generic utilities (<5 functions)
```

## Common False Positives

Skip or downgrade these patterns — they look problematic but are intentional:

1. **Intentional facade modules**: A module that re-exports from multiple sub-modules to provide a clean public API (e.g., `providers/index.tsx`) is a design choice, not a god module
2. **Utility modules with related functions**: A `utils.ts` with 10+ exports is fine if all exports serve the same domain (e.g., all string utilities). Only flag when exports span unrelated domains
3. **Barrel files in component libraries**: Design systems and UI libraries commonly use barrel files (`components/ui/index.ts`) for developer ergonomics — this is standard practice
4. **High import count for framework primitives**: Shared types, constants, or config files legitimately have many importers — measure coupling on logic modules, not type/constant files
5. **Cross-layer imports in server components**: Next.js server components can legitimately access data-layer code directly since they execute server-side

## Related Skills

- For security concerns in architectural patterns, load `security-audit`
- For git-based insights on which modules change most (architectural hotspots), load `git-analysis`
