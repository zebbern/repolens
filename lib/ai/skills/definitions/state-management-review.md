---
id: state-management-review
name: State Management Review
description: Review state management patterns including store design, re-render prevention, data flow architecture, and server/client state separation
trigger: When asked to review state management, optimize re-renders, audit Redux/Zustand stores, check context usage, or assess data flow patterns
relatedTools:
  - searchFiles
  - readFile
  - scanIssues
lastReviewed: "2026-03-08"
reviewCycleDays: 180
---

# State Management Review

## Purpose

Performs a systematic review of state management patterns across the codebase, identifying unnecessary re-renders, improper state colocation, missing selectors, server/client state confusion, and data flow anti-patterns. The analysis traces state from its source through transformations to consuming components, classifying findings by their impact on performance, correctness, and maintainability. The user receives a prioritized list of state management issues with exact locations, measured metrics, and concrete refactoring strategies.

## Prerequisites

Ensure the `searchFiles` and `readFile` tools are available for pattern analysis. The `scanIssues` tool helps detect common anti-patterns. The `getProjectOverview` tool provides context on the framework's state management conventions (e.g., Next.js App Router server components, React Context providers).

## Methodology

Follow this structured approach for every state management review. Complete each phase in order.

### Phase 1: State Inventory

1. Call `getProjectOverview` to understand the project's state management approach
2. Use `searchFiles` to locate all state sources:
   - **Global stores**: search for `create` from Zustand, `createStore` from Redux, `createContext`
   - **Local state**: search for `useState`, `useReducer`
   - **Server cache**: search for `useQuery`, `useSWR`, `use` (React 19), `fetch` in server components
   - **URL state**: search for `useSearchParams`, `useRouter`, `usePathname`
   - **Form state**: search for `useForm`, `useFormState`, `FormData`
3. Map state ownership — which component or module owns each piece of state
4. Identify state that exists in multiple places (potential sync issues)

**Verification**: Before flagging duplicate state, confirm that both instances represent the same data. A component might have a local `isLoading` that shadows a global loading state for intentional decoupling.

### Phase 2: Store Design Analysis

1. Read each global store definition with `readFile`
2. Check store organization:
   - Does a single store hold unrelated state? (e.g., auth + UI preferences + cart items)
   - Are slices logically grouped by domain?
   - Is state normalized or denormalized? (nested objects vs flat with IDs)
3. Check for state shape issues:
   - Deeply nested state (> 3 levels) that makes updates verbose
   - Arrays used where Maps would provide faster lookups
   - Derived state stored instead of computed on read
4. Check for action/mutation issues:
   - Actions that mutate state outside the store pattern
   - Missing type safety on actions or dispatched events

#### Store Design Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| Store slice fields | > 20 | Consider splitting into multiple stores |
| Store slice fields | 10-20 | Review for domain separation |
| Store slice fields | < 10 | Healthy |
| Nesting depth in state | > 3 levels | Flatten or normalize |
| Derived values stored in state | Any | Compute on read instead |
| State updated from > 5 components | N/A | Review ownership — likely needs restructuring |

### Phase 3: Re-render Analysis

1. Use `searchFiles` to find Context providers and their consumers:
   - Search for `createContext`, `useContext`, `Provider value=`
   - Count the number of consumers for each context
2. Identify re-render triggers:
   - **Object identity**: Context value created inline (`value={{ user, theme }}`) — new object every render
   - **Missing selectors**: Zustand consumers using `useStore()` without a selector — subscribes to entire store
   - **Prop spreading**: Components receiving `{...props}` from a parent that re-renders frequently
   - **Array/object dependencies**: `useEffect` or `useMemo` with array/object deps that are recreated each render
3. Use `searchFiles` to check for optimization patterns:
   - `React.memo`, `useMemo`, `useCallback` usage
   - Zustand selectors: `useStore(state => state.specificField)`
   - Context splitting: separate contexts for frequently vs rarely changing data

#### Re-render Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| Context consumers with frequent updates | > 5 consumers | Performance risk — split context or use store |
| Context consumers with frequent updates | 3-5 consumers | Monitor — profile if slow |
| Context consumers with frequent updates | < 3 consumers | Acceptable |
| Zustand `useStore()` without selector | Any in frequently rendered component | Flag — subscribes to full state |
| `useMemo`/`useCallback` with unstable deps | Any | Flag — memo is ineffective |
| Components re-rendering > 3x per user action | N/A | Profile and optimize |

**Verification**: Before flagging a re-render issue, check if the component is lightweight (< 20 JSX elements) and the re-render frequency is low. Not every re-render needs optimization — premature optimization wastes effort.

### Phase 4: Server State Management

1. Use `searchFiles` to find data fetching patterns:
   - Search for `useQuery`, `useSWR`, `fetch`, `axios`, server actions
2. Check cache management:
   - Are cache keys consistent and predictable?
   - Is there proper cache invalidation after mutations?
   - Are stale-while-revalidate patterns used for non-critical data?
3. Check for server/client state confusion:
   - Server-fetched data being duplicated into client state (`useState` initialized from `useQuery`)
   - Client state being used where URL state would provide shareable links
   - Missing optimistic updates on mutations with visible latency
4. Check for loading/error state handling:
   - Is every async data source's loading state handled?
   - Are error states recoverable (retry button, fallback data)?

**Verification**: Before flagging server data copied to client state, check if the component needs to modify the data locally (e.g., form editing a fetched record). Local copies for editing are a valid pattern.

### Phase 5: Data Flow Analysis

1. Trace data flow through the component tree for 2-3 critical features:
   - Where does the data originate? (API, store, prop, URL)
   - How many components does it pass through?
   - Where is it transformed or filtered?
2. Identify anti-patterns:
   - **Prop drilling**: Data passing through > 3 component levels without being used
   - **Event bubbling chains**: Child emits event → parent re-emits → grandparent handles
   - **Implicit dependencies**: Component reads from global store but also receives same data as prop
   - **Bidirectional data flow**: Parent and child both update the same state
3. Check for proper state colocation:
   - Is state defined at the lowest common ancestor of its consumers?
   - Is state lifted higher than necessary? (creates unnecessary re-renders in ancestors)

### Phase 6: Side Effect Audit

1. Use `searchFiles` to find `useEffect` patterns:
   - Search for `useEffect` and check dependency arrays
   - Identify effects that synchronize state (`useEffect(() => { setX(prop) }, [prop])`)
   - Identify effects that could be event handlers instead
2. Check for side effect issues:
   - Missing cleanup functions for subscriptions, timers, or event listeners
   - Race conditions in async effects (stale closure reading outdated state)
   - Effects running on every render due to unstable dependencies
3. Count `useEffect` density per component — high density signals design issues

#### Side Effect Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| `useEffect` per component | > 5 | Design smell — decompose component or extract custom hooks |
| `useEffect` per component | 3-5 | Review — check if effects can be event handlers |
| `useEffect` per component | 1-2 | Healthy |
| `useEffect` with same dependency across components | > 3 | Extract shared custom hook |
| `useEffect` that only sets state from props | Any | Remove — derive during render or use `useMemo` |

### Phase 7: Report

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Store Design, Re-render, Server State, Data Flow, or Side Effects
3. **Location**: Exact file path and line reference
4. **Description**: What the state management issue is
5. **Impact**: Performance degradation, data staleness, or maintainability cost
6. **Remediation**: Specific refactoring pattern with before/after code

Provide an overall summary:

- Total findings by severity and category
- State architecture assessment (well-structured, needs refactoring, needs redesign)
- Top 3 most impactful improvements
- Re-render hotspots by component tree area
- Positive patterns: well-designed state flows worth preserving

## Severity Classification

| Severity | Criteria | Example |
| ---------- | ---------- | --------- |
| **Critical** | State mutation in render path causing infinite loops, stale data displayed to users after mutation | `setState` called unconditionally during render, causing infinite re-renders |
| **High** | Entire app re-renders on single field change, missing cache invalidation causing stale data | Context provider at root with inline `value={{}}` and 15+ consumers |
| **Medium** | Prop drilling through > 3 levels, `useEffect` syncing state that could be derived | State passed `Parent → Layout → Sidebar → SidebarItem → Button` |
| **Low** | Unused fields in store, minor optimization opportunities, redundant memoization | Zustand store with 5 fields only 2 of which are ever read |
| **Informational** | Alternative patterns that could improve DX, optional optimizations | URL state could replace `useState` for filter values (enables sharing links) |

## Example Output

````markdown
### Finding: Re-render Cascade — Root Context Provider with Inline Value

- **Severity**: High
- **Category**: Re-render
- **Location**: `providers/app-provider.tsx` line 24
- **Description**: The `AppProvider` creates a new context value object on every render:
  ```tsx
  <AppContext.Provider value={{ user, settings, notifications, theme }}>
  ```
  This context has 12 consumers across the app. Any state change in `AppProvider` (including unrelated state like `notifications`) triggers re-renders in all 12 consumers, even those that only read `theme`.
- **Impact**: Every notification update re-renders the settings panel, user profile, and theme toggle — none of which depend on notifications. In a component tree with expensive children, this causes visible jank.
- **Remediation**: Split into domain-specific contexts:
  ```tsx
  // Before: one context with everything
  <AppContext.Provider value={{ user, settings, notifications, theme }}>

  // After: separate contexts by update frequency
  <UserContext.Provider value={userValue}>
    <ThemeContext.Provider value={themeValue}>
      <NotificationContext.Provider value={notificationValue}>
  ```
  Alternatively, migrate to Zustand with selectors for granular subscriptions.
````

## Common False Positives

Skip or downgrade these patterns — they look like state management issues but are acceptable:

1. **Intentional full re-renders**: Theme changes, locale switches, and auth state transitions legitimately trigger wide re-renders — these are infrequent and expected
2. **Small apps where optimization is premature**: If the component tree has < 50 components and no measured performance issues, re-render optimization adds complexity without benefit
3. **Server components that don't re-render**: In Next.js App Router, server components render once on the server — they cannot re-render on state changes and do not need memoization
4. **Memo'd components with stable props**: A component wrapped in `React.memo` that receives only primitive props or stable references is already optimized — no further action needed
5. **Test-only state patterns**: State management in test utilities, Storybook stories, or dev tools follows different rules — development convenience outweighs optimization
6. **Form libraries managing state internally**: Libraries like React Hook Form manage re-renders internally with ref-based tracking — `useForm()` consumers aren't subject to normal re-render concerns

## Related Skills

- For measuring render performance and profiling slow interactions, load `performance-analysis`
- For reviewing component structure and decomposition, load `code-complexity`
- For checking data flow at API boundaries, load `api-design-review`
