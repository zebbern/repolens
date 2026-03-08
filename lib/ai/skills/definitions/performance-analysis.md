---
id: performance-analysis
name: Performance Analysis
description: Systematic detection of performance bottlenecks including N+1 queries, unnecessary re-renders, bundle bloat, missing lazy loading, and unoptimized data fetching
trigger: When asked to find performance issues, optimize code, check for slow patterns, or reduce bundle size
relatedTools:
  - scanIssues
  - readFile
  - searchFiles
  - analyzeImports
---

## Purpose

Performs a systematic performance audit of the codebase by analyzing bundle composition, data fetching patterns, rendering efficiency, and asset delivery. The analysis applies quantitative thresholds to classify findings by severity — distinguishing real bottlenecks from minor optimization opportunities. The user receives a prioritized list of performance issues with exact file locations, measured impact, and specific remediation guidance.

## Prerequisites

Ensure the `scanIssues` and `analyzeImports` tools are available before proceeding. If `analyzeImports` is unavailable, fall back to `searchFiles` for import pattern analysis. The `getProjectOverview` tool provides essential context for identifying the tech stack and rendering model.

## Methodology

Follow this structured approach for every performance analysis. Complete each phase in order.

### Phase 1: Context Gathering

1. Call `getProjectOverview` to understand the tech stack, framework, and rendering model
2. Identify the runtime environment: server-rendered, client SPA, hybrid (Next.js SSR + CSR), or edge
3. Read configuration files (`next.config.*`, `vite.config.*`, `webpack.config.*`) for optimization settings
4. Determine the data layer: ORM (Prisma, Drizzle), raw SQL, REST APIs, GraphQL
5. Note existing optimizations already in place (code splitting config, image optimization, caching headers)

### Phase 2: Bundle & Loading Analysis

1. Use `analyzeImports` on entry point files and key pages to map the dependency tree
2. Search for large library imports that should be code-split:
   - `searchFiles` for patterns: `import .* from ['"]lodash['"]`, `import .* from ['"]moment['"]`, `import .* from ['"]chart`
3. Check for missing dynamic imports on heavy components:
   - Search for heavy UI libraries imported statically: `recharts`, `monaco-editor`, `@uiw/react-md-editor`, `mapbox-gl`
4. Verify lazy loading on route-level components and below-the-fold content
5. Check for barrel file imports that pull in entire module trees:
   - Look for `import { OneSmallThing } from './components'` patterns where the barrel re-exports many modules

**Quantitative Thresholds**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Single import estimated > 100KB | Flag for code splitting | Use dynamic `import()` or `React.lazy` |
| Static import of chart/editor/map library | Flag for lazy loading | Wrap in `dynamic()` or `Suspense` |
| Barrel import pulling > 10 re-exports | Flag for direct imports | Import from specific file paths |
| Page with > 5 heavy static imports | Flag for review | Prioritize above-the-fold content |

### Phase 3: Data Fetching Analysis

1. Use `searchFiles` to locate data fetching patterns:
   - Database queries: `prisma.`, `db.query`, `sql`, `.findMany`, `.findAll`
   - API calls: `fetch(`, `axios.`, `useSWR`, `useQuery`
2. Check for N+1 query patterns:
   - Loop constructs (`.map`, `.forEach`, `for`) containing database calls or API requests
   - Sequential awaits in loops: `for ... await db.`
3. Check for missing query constraints:
   - `findMany()` or `SELECT *` without `LIMIT`, `take`, or pagination
4. Check for request waterfalls:
   - Sequential `await` calls that could be parallelized with `Promise.all`
5. Check for missing caching on expensive or repeated queries:
   - Same query called from multiple components without caching layer

**Quantitative Thresholds**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Database/API call inside a loop | Always flag | Batch or use `WHERE IN` / bulk endpoint |
| Query without LIMIT/take on list data | Always flag | Add pagination or bounded limit |
| Sequential awaits (> 2) with no data dependency | Flag for parallelization | Use `Promise.all` or `Promise.allSettled` |
| Same endpoint called > 2 times per page load | Flag for caching | Add SWR, React Query, or server-side cache |

**Verification**: Before flagging N+1, confirm the loop actually iterates more than once at runtime. A `.map` over a static config array of 3 items is not a real N+1.

### Phase 4: Rendering Analysis

1. Use `searchFiles` to find rendering-intensive patterns:
   - Search for: `useEffect`, `useState`, `useMemo`, `useCallback`, `memo(`
2. Check for unnecessary re-renders:
   - Components creating new objects/arrays in render: `style={{ ... }}`, `options={[...]}` as inline props
   - Missing `key` props on list items or non-stable keys (`index` as key on reorderable lists)
   - Context providers with inline value objects: `value={{ a, b, c }}`
3. Check for missing memoization on expensive computations:
   - Sorting, filtering, or transforming large arrays without `useMemo`
4. Check for layout thrashing:
   - DOM reads followed by DOM writes in alternation
   - Measuring element dimensions inside render loops

**Quantitative Thresholds**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Component with > 5 `useState` calls | Review for state consolidation | Consider `useReducer` or state object |
| Context provider re-rendering > 20 consumers | Flag value memoization | Memoize context value or split contexts |
| Array/object sort/filter in render without `useMemo` on > 50 items | Flag for memoization | Wrap in `useMemo` with proper deps |
| Inline object/array props on frequently re-rendered component | Flag if parent re-renders often | Extract to constant or `useMemo` |

**Verification**: Before flagging missing memoization, check if the component actually re-renders frequently. A component rendered once on page load doesn't benefit from `useMemo`.

### Phase 5: Asset Optimization

1. Check image handling:
   - Search for raw `<img>` tags instead of framework image components (`next/image`, `nuxt-img`)
   - Look for missing `width`/`height` attributes (CLS risk)
   - Check for missing lazy loading on below-the-fold images
2. Check for large static assets:
   - JSON files imported statically that could be fetched on demand
   - Font files loaded without `font-display: swap`
3. Check API response sizes:
   - Endpoints returning full objects when only a subset of fields is needed
   - Missing compression headers on API responses

### Phase 6: Report

For each finding, report:
1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Bundle, Data Fetching, Rendering, or Assets
3. **Location**: Exact file path and line reference
4. **Description**: What the performance issue is
5. **Measured Impact**: Quantified effect (estimated bundle size, query count, render count)
6. **Remediation**: Specific code changes with before/after examples
7. **Confidence**: High / Medium / Low — based on static analysis vs runtime verification

Provide an overall summary:
- Total findings by severity and category
- Top 3 highest-impact issues to address first
- Quick wins (low-effort, high-impact fixes)
- Positive patterns already in place

## Severity Classification

| Severity | Criteria | Example |
|----------|----------|---------|
| **Critical** | N+1 query on production-critical path, unbounded query on large table | `for (const user of users) { await db.posts.findMany({ where: { userId: user.id } }) }` |
| **High** | Missing code splitting on module > 100KB, request waterfall blocking page load | Static import of `recharts` on every page when only used on dashboard |
| **Medium** | Missing memoization on expensive computation, inline object props causing re-renders | Sorting 500-item array in render without `useMemo` |
| **Low** | Minor optimization opportunity, image without explicit dimensions | Missing `width`/`height` on a small decorative image |
| **Informational** | Best practice suggestion, defense-in-depth optimization | Could prefetch data for likely next navigation |

## Example Output

```
### Finding: N+1 Query in Repository Loading — `lib/api/repos.ts`

- **Severity**: Critical
- **Confidence**: High
- **Category**: Data Fetching
- **Location**: `lib/api/repos.ts` lines 34-42
- **Description**: The `getReposWithStats` function fetches all repositories, then loops over each to fetch individual stats with separate database calls. For a user with 50 repositories, this results in 51 queries (1 list + 50 detail).
- **Measured Impact**: Query count scales linearly with repository count. At 50 repos, ~51 DB round trips; at 200 repos, ~201 round trips.
- **Remediation**: Use a single query with JOIN or batch the stats query:
  ```ts
  // Before (N+1)
  const repos = await db.repo.findMany({ where: { ownerId } });
  for (const repo of repos) {
    repo.stats = await db.repoStats.findUnique({ where: { repoId: repo.id } });
  }

  // After (single query)
  const repos = await db.repo.findMany({
    where: { ownerId },
    include: { stats: true },
  });
  ```
```

## Common False Positives

Skip or downgrade these patterns — they are frequently flagged but rarely problematic:

1. **Development-only logging and debugging**: `console.log` statements, React DevTools profiling hooks, and debug-mode re-renders are stripped in production builds
2. **Intentional eager loading**: Some data is intentionally loaded upfront for UX reasons (e.g., preloading the next page's data, prefetching critical resources). Check for comments or naming conventions indicating intent
3. **Small dataset contexts**: An N+1 pattern iterating over 3-5 fixed items (e.g., config entries, enum values) has negligible real impact. Only flag N+1 when the iteration count is unbounded or user-controlled
4. **Test fixtures and seed data**: Large JSON imports in test files or seed scripts don't affect production bundle size
5. **Server-side code in SSR frameworks**: Heavy imports in server components (Next.js `app/` directory without `'use client'`) don't affect client bundle size — they run server-side only

## Related Skills

- For module structure and dependency analysis that feeds into bundle analysis, load `architecture-analysis`
- For identifying which modules to prioritize optimization on (based on change frequency), load `git-analysis`
- For complexity-driven refactoring that may resolve performance issues, load `code-complexity`
