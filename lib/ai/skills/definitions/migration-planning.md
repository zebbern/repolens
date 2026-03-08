---
id: migration-planning
name: Migration Planning
description: Analyze framework and library upgrade paths, identify breaking changes, assess migration complexity, and generate step-by-step migration plans
trigger: When asked to plan a migration, assess upgrade impact, find breaking changes, evaluate framework upgrades, or create migration checklists
relatedTools:
  - readFile
  - searchFiles
  - getProjectOverview
lastReviewed: "2026-03-08"
reviewCycleDays: 180
---

# Migration Planning

## Purpose

Performs a systematic migration assessment by inventorying current framework and library versions, researching target version changes, quantifying affected files and API surface, and generating a step-by-step migration plan with risk classification. The analysis distinguishes between blocking breaking changes, parallelizable updates, and optional improvements — producing a prioritized migration checklist with rollback strategies, testing requirements, and estimated blast radius per step.

## Prerequisites

Ensure the `getProjectOverview` tool is available to understand the current tech stack and dependency tree. The `readFile` tool is required for inspecting configuration files (`package.json`, `tsconfig.json`, framework configs). The `searchFiles` tool is needed to locate usage of deprecated or breaking APIs across the codebase.

## Methodology

Follow this structured approach for every migration assessment. Complete each phase in order.

### Phase 1: Current State Inventory

1. Call `getProjectOverview` to understand the project scope, tech stack, and directory structure
2. Read `package.json` to catalog all dependencies and their current versions
3. Read framework configuration files (`next.config.mjs`, `tsconfig.json`, `tailwind.config.ts`, etc.)
4. Identify dependency tree depth — which packages depend on which
5. Catalog adapter/plugin versions (e.g., ESLint configs, PostCSS plugins, Babel presets)
6. Note the project's Node.js version target and module system (ESM vs CJS)

### Phase 2: Target Analysis

1. Research the target version's changelog and migration guide
2. Catalog all breaking changes between the current and target version
3. Catalog deprecated APIs that still work but should be updated
4. Identify new features or patterns the target version enables
5. Check peer dependency requirements — does the target version require upgrading other packages?
6. Verify Node.js version compatibility with the target

**Verification**: Before listing a breaking change, confirm it applies to the project's actual usage. A breaking change to an API the project doesn't use is informational, not actionable.

### Phase 3: Impact Assessment

1. For each breaking change, use `searchFiles` to count affected files:
   - Search for deprecated API names, import paths, configuration keys
   - Search for patterns that the migration guide specifically calls out
2. Measure the blast radius per breaking change:
   - How many files reference the affected API?
   - How many modules depend on the changed behavior?
   - Are the affected files in critical paths (auth, payments, data fetching)?
3. Classify each change by effort:
   - **Automated**: Can be fixed with a codemod or find-and-replace
   - **Mechanical**: Simple manual change repeated across files
   - **Requires judgment**: New pattern or API with multiple migration options

#### Migration Impact Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| Total files affected | > 50 | High-risk migration — phase in stages |
| Total files affected | 20-50 | Moderate — plan for focused sprint |
| Total files affected | < 20 | Low-risk — can be done in a single PR |
| Breaking API changes | > 5 | Needs phased approach with intermediate commits |
| Breaking API changes | 2-5 | Manageable — batch into logical groups |
| Breaking API changes | 1 | Single focused change |
| Major version jumps | > 3 | Extreme risk — consider stepping through intermediate versions |
| Major version jumps | 2-3 | High risk — check for compounding breaks |
| Major version jumps | 1 | Standard upgrade path |
| Peer dependency cascades | > 5 packages | Coordinate upgrades carefully |

### Phase 4: Migration Path

1. Order the breaking changes by dependency — some changes must happen before others
2. Identify parallel-safe changes that can be done in any order
3. For each step, define:
   - **What changes**: Exact API replacements, config updates, import path changes
   - **Codemod available?**: Link to official codemods or describe a find-and-replace pattern
   - **Blocking or parallel**: Can this be merged independently?
   - **Verification**: How to confirm this step is complete (test command, build check, manual QA)
4. Group steps into logical milestones (e.g., "Update config files" → "Migrate deprecated APIs" → "Adopt new patterns")

**Verification**: Before recommending a migration order, confirm that intermediate states compile and tests pass. A migration plan that breaks the build at step 3 of 10 is unshippable.

### Phase 5: Risk Assessment

1. Identify rollback strategy for each migration step:
   - Can the change be reverted with `git revert` cleanly?
   - Does the step require database migrations that are hard to reverse?
   - Are there feature flags that can gradually roll out the change?
2. Assess incremental vs big-bang migration:
   - **Incremental**: migrate module-by-module with compatibility layers (preferred for > 20 affected files)
   - **Big-bang**: single PR that migrates everything (acceptable for < 10 affected files)
3. Identify runtime behavior changes that won't surface as type errors:
   - Default value changes
   - Timing/ordering changes in lifecycle hooks
   - Serialization format changes

### Phase 6: Testing Strategy

1. Identify tests that cover affected code paths
2. Recommend additional tests for changed behavior:
   - Regression tests for areas where defaults changed
   - Integration tests for updated API calls
   - Smoke tests for critical user flows post-migration
3. Define the verification checklist:
   - Build passes with zero errors
   - All existing tests pass
   - Manual QA of critical flows (list specific flows)
   - Performance benchmarks if the migration affects rendering or data fetching

### Phase 7: Report

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Breaking Change, Deprecation, Configuration, Peer Dependency, or New Feature
3. **Location**: Affected files and import paths
4. **Description**: What is changing and why
5. **Migration Path**: Step-by-step fix with code examples
6. **Blast Radius**: Number of affected files and modules
7. **Effort Estimate**: Automated, Mechanical, or Requires Judgment

Provide an overall summary:

- Total breaking changes by severity
- Migration complexity rating (Low / Moderate / High / Extreme)
- Recommended migration strategy (incremental vs big-bang)
- Ordered migration checklist with milestones
- Rollback plan for each milestone
- Testing requirements

## Severity Classification

| Severity | Criteria | Example |
| ---------- | ---------- | --------- |
| **Critical** | Breaking change with no clear migration path, or runtime behavior change that silently corrupts data | Removed API with no replacement, serialization format change affecting stored data |
| **High** | Deprecated API used in > 10 files, peer dependency cascade requiring multiple coordinated upgrades | `getServerSideProps` removal affecting 15 page files in Next.js 15 upgrade |
| **Medium** | Configuration format change, import path rename, or new required field | `next.config.js` → `next.config.mjs` with new export format |
| **Low** | New feature available but not required, optional performance improvement | New `optimizePackageImports` config option in Next.js |
| **Informational** | Cosmetic changes, updated default behaviors that match existing project settings | Default strict mode already enabled in project's tsconfig |

## Example Output

````markdown
### Finding: Breaking Change — `next/image` Layout Prop Removed

- **Severity**: High
- **Category**: Breaking Change
- **Location**: 12 files across `components/` and `app/` directories
- **Description**: Next.js 14 removed the `layout` prop from `next/image`. The project uses `layout="responsive"` in 8 components and `layout="fill"` in 4 components. These must be migrated to the `fill` boolean prop or `style`-based sizing.
- **Blast Radius**: 12 files, 3 shared components used across 20+ pages
- **Effort**: Mechanical — consistent replacement pattern
- **Migration Path**:
  ```tsx
  // Before
  <Image src={src} layout="responsive" width={800} height={600} />

  // After
  <Image src={src} width={800} height={600} style={{ width: '100%', height: 'auto' }} />

  // Before
  <Image src={src} layout="fill" objectFit="cover" />

  // After
  <Image src={src} fill style={{ objectFit: 'cover' }} />
  ```
- **Codemod**: `npx @next/codemod@latest next-image-to-legacy-image .` (converts to legacy, then manually update)
- **Verification**: Search for remaining `layout=` props, build, visual regression test on image-heavy pages
````

## Common False Positives

Skip or downgrade these patterns — they look like migration risks but are acceptable:

1. **Peer dependency warnings for optional features**: npm/pnpm warn about peer dependencies for plugins or adapters the project doesn't use — these are noise, not blockers
2. **Dev-only tooling changes**: Breaking changes in ESLint plugins, Prettier, or build-only tools rarely affect production code — classify as Low unless they block CI
3. **Type-only breaking changes**: Generic constraint changes or stricter type signatures that are fixed by adjusting type annotations — these surface at compile time and have zero runtime risk
4. **Optional new features flagged as breaking**: Changelogs sometimes list new required fields that only apply to specific configurations the project doesn't use
5. **Transitive dependency updates**: A dependency's dependency being updated is usually handled by the package manager — only flag if the project directly imports from the transitive dependency

## Related Skills

- For assessing current dependency health and outdated versions, load `dependency-health`
- For planning post-migration test coverage, load `testing-quality`
- For evaluating architectural impact of framework changes, load `architecture-analysis`
