---
id: architecture-analysis
name: Architecture Analysis
description: Systematic approach to dependency mapping, layer identification, and architecture diagram generation
trigger: When asked to analyze architecture, map dependencies, identify layers, or generate architecture diagrams
relatedTools:
  - analyzeImports
  - getProjectOverview
  - generateDiagram
---

## Prerequisites

Ensure the `analyzeImports`, `getProjectOverview`, and `generateDiagram` tools are available before proceeding. If `generateDiagram` is unavailable, produce raw Mermaid syntax instead.

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

### Phase 5: Analysis & Recommendations

Assess the architecture against best practices:

**Coupling Analysis**
- Are modules tightly or loosely coupled?
- Can modules be tested independently?
- Are there god modules that know too much?

**Cohesion Analysis**
- Does each module have a single, clear responsibility?
- Are related functions grouped together?

**Dependency Direction**
- Do dependencies flow in the correct direction?
- Are there dependency inversions where needed?
- Are infrastructure details leaking into business logic?

**Scalability Concerns**
- Are there bottleneck modules that everything depends on?
- Can the architecture support horizontal scaling?

### Phase 6: Report

Deliver:
1. Architecture overview with identified layers and their responsibilities
2. Module dependency map with import/export relationships
3. Generated diagrams (topology, import graph, data flow)
4. List of architectural concerns and recommendations
5. Positive architectural decisions worth preserving
