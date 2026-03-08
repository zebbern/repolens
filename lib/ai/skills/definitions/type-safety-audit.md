---
id: type-safety-audit
name: Type Safety Audit
description: Audit TypeScript type safety including any usage, type narrowing patterns, generic constraints, runtime type validation, and strict mode compliance
trigger: When asked to check type safety, find any types, audit TypeScript strictness, review generics, or assess type coverage
relatedTools:
  - searchFiles
  - readFile
  - scanIssues
lastReviewed: "2026-03-08"
reviewCycleDays: 180
standardsReferenced:
  - name: TypeScript
    pinnedVersion: "5.7"
---

# Type Safety Audit

## Purpose

Performs a systematic audit of TypeScript type safety across the codebase, identifying `any` type usage, unsafe type assertions, missing runtime validation at system boundaries, and overly permissive generic constraints. The analysis distinguishes between intentional type flexibility (third-party workarounds, migration-phase code) and genuine type safety holes that risk runtime errors. The user receives a prioritized list of type safety findings with exact locations, measured metrics, and concrete fixes.

## Prerequisites

Ensure the `searchFiles` tool is available for pattern-based analysis across the codebase. The `readFile` tool is required for inspecting `tsconfig.json` strict mode flags and detailed type patterns. The `scanIssues` tool helps surface TypeScript compiler diagnostics that indicate type weaknesses.

## Methodology

Follow this structured approach for every type safety audit. Complete each phase in order.

### Phase 1: Strict Mode Compliance

1. Read `tsconfig.json` with `readFile` and check strict mode flags:
   - `"strict": true` — master switch for all strict checks
   - If `strict` is not `true`, check individual flags:
     - `strictNullChecks` — prevents `null`/`undefined` from being assignable to all types
     - `strictFunctionTypes` — enforces contravariant parameter checking
     - `noImplicitAny` — forbids implicit `any` when type cannot be inferred
     - `strictPropertyInitialization` — ensures class properties are initialized
     - `noUncheckedIndexedAccess` — makes index signatures return `T | undefined`
2. Check for `skipLibCheck` — if `true`, third-party type errors are hidden
3. Check for path aliases and whether they resolve correctly (misconfigured paths cause implicit `any`)

**Verification**: Before flagging missing strict flags, check if the project is in a TypeScript migration phase (`.js` files coexisting with `.ts`). Gradual migration may intentionally relax strictness temporarily.

### Phase 2: `any` Census

1. Use `searchFiles` to count explicit `any` usage:
   - Search for `: any` — explicit any type annotations
   - Search for `as any` — type assertion to any
   - Search for `@ts-ignore` — suppresses all errors on the next line
   - Search for `@ts-expect-error` — suppresses a specific expected error
   - Search for `// @ts-nocheck` — disables type checking for entire file
2. For each occurrence, classify by location:
   - **Public API boundary**: function parameters, return types, exported interfaces — Critical
   - **Internal implementation**: local variables, private helpers — Medium
   - **Third-party workaround**: working around library type bugs — Low (with comment)
   - **Test code**: mocks, fixtures, type stubs — Informational
3. Count total `any` occurrences and calculate `any` density (occurrences per 1000 lines)

#### Type Safety Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| Files with `any` as % of total `.ts` files | > 5% | Systemic issue — needs codebase-wide effort |
| Files with `any` as % of total `.ts` files | 2-5% | Elevated — track and reduce |
| Files with `any` as % of total `.ts` files | < 2% | Healthy |
| `@ts-ignore` count | > 10 | Tech debt flag — migrate to `@ts-expect-error` or fix |
| `@ts-ignore` count | 5-10 | Review each for necessity |
| `@ts-ignore` count | < 5 | Acceptable if documented |
| `as` type assertions (non-`any`) | > 20 | Needs type guard refactor |
| `as` type assertions (non-`any`) | 10-20 | Review critical path assertions |
| `as` type assertions (non-`any`) | < 10 | Healthy |
| `// @ts-nocheck` files | Any | Always flag — entire file unchecked |

### Phase 3: Type Narrowing Patterns

1. Use `searchFiles` to find type assertion patterns:
   - Search for `as` (type assertion syntax) — distinguish safe narrowing from unsafe casts
   - Search for `!` (non-null assertion) — risky if the value can actually be null
2. Classify each assertion:
   - **Safe narrowing**: `as const`, `as keyof typeof`, narrowing after type guard — acceptable
   - **Unsafe cast**: `as SomeType` without prior validation — potential runtime error
   - **Non-null assertion**: `value!.property` — risky unless preceded by null check
3. Look for patterns that should use type guards instead:
   - `if ((value as SomeType).field)` — cast before check, should be guard
   - Switch statements on union types without exhaustive checking
   - Optional chaining used to avoid proper narrowing (`value?.field?.nested?.deep`)

**Verification**: Before flagging a type assertion, check if it follows a runtime check that already narrows the type. Pattern: `if (isUser(value)) { return value as User; }` — the guard validates the assertion.

### Phase 4: Generic Patterns

1. Use `searchFiles` to find generic definitions:
   - Search for `<T>`, `<T extends`, `<T, U>` in function and class definitions
2. Check for generic issues:
   - **Unconstrained generics**: `<T>` where `<T extends SomeBase>` would be more precise
   - **Overly broad constraints**: `<T extends object>` when `<T extends Record<string, unknown>>` is meant
   - **Redundant generics**: `<T>` used only once in the signature — could be a concrete type
   - **Generic parameter shadowing**: inner generic `<T>` hiding outer `<T>` in nested scopes
3. Check for proper generic inference:
   - Are callers forced to provide explicit type arguments that could be inferred?
   - Are generic defaults (`<T = string>`) used appropriately?

### Phase 5: Runtime Validation Boundaries

1. Use `searchFiles` to locate system boundary entry points:
   - API route handlers (`app/api/`)
   - Form handlers and server actions
   - External data parsing (JSON.parse, file reads, URL params)
   - Third-party API response handling
2. For each entry point, check:
   - Is incoming data validated with a runtime schema? (Zod, Valibot, io-ts, Yup)
   - Is the validated type used downstream? (not `any` after validation)
   - Are validation errors returned with specific field-level feedback?
3. Search for dangerous patterns:
   - `JSON.parse()` without subsequent validation — returns `any`
   - `req.body` used directly without parsing
   - `searchParams.get()` used without null checking or type coercion

**Verification**: Before flagging missing runtime validation, check if the data source is trusted and internal. Server component data passed via props from a parent server component doesn't need runtime validation — TypeScript already checks it at compile time.

### Phase 6: Type Inference Quality

1. Use `searchFiles` to find redundant type annotations:
   - Explicit return types on trivial functions where inference works
   - Type annotations on variables initialized with literals (`const x: string = "hello"`)
   - Redundant generic parameters that TypeScript already infers
2. Find missing annotations where inference fails:
   - Functions with complex conditional return types
   - Exported functions without explicit return types (API contracts)
   - Variables initialized from `any`-returning functions

### Phase 7: Report

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Strict Mode, `any` Usage, Type Assertion, Generic, Validation, or Inference
3. **Location**: Exact file path and line reference
4. **Description**: What the type safety gap is
5. **Impact**: What can go wrong at runtime due to this type gap
6. **Fix**: Specific type-safe replacement with code example

Provide an overall summary:

- Total findings by severity and category
- Type safety score: percentage of files with zero `any`/`as`/`@ts-ignore`
- `any` density: occurrences per 1000 lines of TypeScript
- Top 3 highest-risk type safety gaps
- Systemic patterns that need project-wide fixes
- Positive patterns: well-typed modules worth preserving

## Severity Classification

| Severity | Criteria | Example |
| ---------- | ---------- | --------- |
| **Critical** | `any` in public API or data validation boundary, `@ts-nocheck` on production file | API route handler accepting `body: any` without validation |
| **High** | `@ts-ignore` suppressing a real error, unsafe `as` on user-facing data path | `const user = data as User` without validating `data` shape |
| **Medium** | Unsafe type assertion in business logic, unconstrained generic in shared utility | `as` cast in a calculation function that could use a type guard |
| **Low** | Redundant type annotations, minor generic improvements, `any` in internal utility | `const count: number = items.length` — redundant annotation |
| **Informational** | Style suggestions, inference improvements, stricter flag recommendations | Enabling `noUncheckedIndexedAccess` for safer array/object access |

## Example Output

````markdown
### Finding: Unsafe Type Assertion on API Response

- **Severity**: High
- **Category**: Type Assertion
- **Location**: `lib/github/api.ts` line 89
- **Description**: The GitHub API response is cast directly to a typed interface without runtime validation:
  ```ts
  const data = await response.json();
  return data as GitHubRepository;
  ```
  If the GitHub API changes its response shape, adds a field, or returns an error object, the cast silently succeeds and downstream code receives malformed data.
- **Impact**: Runtime errors when accessing properties that don't exist on the actual response. Errors surface far from the cast site, making debugging difficult.
- **Fix**: Add Zod validation at the API boundary:
  ```ts
  import { z } from "zod";

  const GitHubRepositorySchema = z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    private: z.boolean(),
    default_branch: z.string(),
  });

  const data = await response.json();
  const parsed = GitHubRepositorySchema.parse(data);
  return parsed; // type is inferred from schema
  ```
````

## Common False Positives

Skip or downgrade these patterns — they look like type safety issues but are acceptable:

1. **`any` in legacy code being actively migrated**: If the file has a migration TODO and the `any` usage is decreasing over time, flag as Informational rather than High
2. **Third-party library type workarounds**: Some libraries have incorrect or incomplete types — `as` casts with an explanatory comment linking to the issue are acceptable stopgaps
3. **Test mocks with `any`**: Test utilities like `jest.fn()`, `vi.fn()`, and partial mocks legitimately use `any` or `as` to create test doubles — this is expected
4. **Type-level utility code**: Files that implement type-level programming (`infer`, conditional types, mapped types) may use `any` at the type level for valid generic programming purposes
5. **`@ts-expect-error` with explanation**: Unlike `@ts-ignore`, `@ts-expect-error` fails if the error disappears — it's a self-maintaining suppression that is acceptable when documented
6. **Generated types**: Schema-generated types (Prisma, GraphQL codegen, OpenAPI) are auto-maintained — don't flag their internal patterns

## Related Skills

- For API contract type safety and request/response typing, load `api-design-review`
- For error type hierarchies and error handling patterns, load `error-handling-review`
- For runtime validation in form handling, load `testing-quality`
