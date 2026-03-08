---
id: error-handling-review
name: Error Handling Review
description: Review error handling consistency, unhandled promise rejections, missing try/catch boundaries, error recovery patterns, and user-facing error messages
trigger: When asked to review error handling, find unhandled errors, audit try/catch patterns, check error boundaries, or assess error recovery
relatedTools:
  - searchFiles
  - readFile
  - scanIssues
lastReviewed: "2026-03-08"
reviewCycleDays: 180
---

# Error Handling Review

## Purpose

Performs a systematic review of error handling patterns across the codebase, identifying unhandled exceptions, inconsistent error formats, missing recovery mechanisms, and leaked internal details. The analysis traces error propagation paths from throw sites through catch boundaries to user-facing responses, classifying findings by severity based on their production impact. The user receives a prioritized list of error handling gaps with exact locations, risk assessment, and concrete remediation patterns.

## Prerequisites

Ensure the `scanIssues` tool is available to detect common error handling issues. If unavailable, fall back to `searchFiles` and `readFile` for manual pattern analysis. The `getProjectOverview` tool provides essential context for understanding the framework's built-in error handling (e.g., Next.js error boundaries, Express error middleware).

## Methodology

Follow this structured approach for every error handling review. Complete each phase in order.

### Phase 1: Error Boundary Audit

1. Call `getProjectOverview` to understand the framework and its error handling conventions
2. Use `searchFiles` to locate error boundary components and middleware:
   - React: search for `ErrorBoundary`, `error.tsx`, `getDerivedStateFromError`, `componentDidCatch`
   - Next.js: search for `error.tsx` and `global-error.tsx` in the App Router
   - API: search for error middleware, `onError`, global exception handlers
3. Map the error boundary coverage:
   - Which route segments have dedicated `error.tsx` files?
   - Are there nested error boundaries for critical UI sections?
   - Is there a root-level error boundary catching uncaught errors?
4. Verify that error boundaries render meaningful fallback UI, not blank screens

**Verification**: Before flagging missing error boundaries, check if the parent route segment already has an `error.tsx` that covers child routes. In Next.js App Router, error boundaries bubble up to the nearest parent.

### Phase 2: Promise Handling

1. Use `searchFiles` to find async patterns:
   - Search for `async function` and `await` keywords
   - Search for `.then(` without `.catch(` — unhandled promise chains
   - Search for `Promise.all`, `Promise.allSettled`, `Promise.race` — bulk promise handling
2. For each async function, check if it has error handling:
   - Try/catch wrapping the await call
   - `.catch()` on the promise chain
   - Error propagation to a higher-level handler
3. Check for floating promises — async calls without `await` or `.catch()`

#### Promise Handling Thresholds

| Pattern | Threshold | Classification |
| ------- | --------- | ------------- |
| `async` function without any try/catch or .catch() | Any in production code | Flag — unhandled rejection risk |
| `.then()` chain without `.catch()` | Any | Flag — silent failure |
| `Promise.all` without try/catch | Any | Flag — one rejection kills all |
| Empty catch block `catch (e) {}` | Any | Always flag — silent error swallowing |
| Catch block with only `console.error` | Review | Investigate — may need rethrow or recovery |
| `catch (e) { throw e }` | Any | Noise — remove the try/catch entirely |
| Floating promise (no await, no .catch) | Any | Flag — fire-and-forget error sink |

**Verification**: Before flagging an async function without try/catch, check if it is called within a try/catch block at the call site, or if the framework handles the rejection (e.g., Next.js route handlers auto-catch for 500 responses).

### Phase 3: API Error Responses

1. Use `searchFiles` to locate API route handlers
2. For each handler, check error response consistency:
   - Do all error responses use the same format? (e.g., `{ error: string, code: string }`)
   - Are HTTP status codes appropriate? (400 for validation, 401 for auth, 404 for not found, 500 for server)
   - Are internal error details (stack traces, SQL errors, internal paths) excluded from responses?
3. Check for catch-all error handling in API routes:
   - Does the handler catch unexpected errors and return a generic 500?
   - Are error details logged server-side while the client gets a safe message?

#### Error Response Consistency Checklist

| Check | Expected | Severity if Missing |
| ----- | -------- | ------------------- |
| Consistent error object shape | Same keys across all error responses | Medium |
| Appropriate HTTP status codes | 4xx for client errors, 5xx for server errors | Medium |
| No stack traces in response body | Stack traces logged server-side only | High |
| No internal paths in error messages | File paths, SQL queries, internal IDs hidden | High |
| Error messages are actionable | User understands what went wrong and what to do | Low |

**Verification**: Before flagging a leaked stack trace, confirm it is included in the HTTP response body, not just logged server-side. Server-side logging of full error details is expected and correct behavior.

### Phase 4: Validation Boundaries

1. Use `searchFiles` to find system boundary entry points:
   - API route handlers: request body, query params, headers
   - Form handlers: form submissions, user input
   - File processors: uploaded files, imported data
   - URL parameters: dynamic route segments
2. For each entry point, check:
   - Is the input validated before use? (zod, yup, joi, manual checks)
   - Are validation errors returned with specific field-level feedback?
   - Is the raw input ever passed directly to a database query, file system operation, or external API?

**Verification**: Before flagging missing validation, check if the framework provides automatic validation (e.g., Next.js App Router validates route params as strings) or if TypeScript types provide compile-time safety for internal-only interfaces.

### Phase 5: Recovery Patterns

1. Use `searchFiles` to find retry and fallback patterns:
   - Search for: `retry`, `fallback`, `default`, `graceful`, `degrade`
   - Search for timeout handling: `AbortController`, `setTimeout`, `signal`
2. Check critical paths for recovery mechanisms:
   - API calls: Do they retry on transient failures (network errors, 429, 503)?
   - Cache reads: Is there a fallback when cache is unavailable?
   - External services: Is there graceful degradation when a service is down?
3. Evaluate retry configurations:
   - Maximum retry count (recommend 2-3 for most operations)
   - Exponential backoff or jitter to prevent thundering herd
   - Idempotency verification for retried write operations

### Phase 6: Error Logging

1. Use `searchFiles` to find error logging patterns:
   - Search for: `console.error`, `console.warn`, `logger.error`, `captureException`, `Sentry`
2. Check logging quality:
   - Are errors logged with context? (operation name, input parameters, user ID)
   - Are errors logged at the appropriate level? (error vs. warn vs. info)
   - Is sensitive data excluded from logs? (passwords, tokens, PII)
3. Check for silently swallowed errors:
   - Empty catch blocks
   - Catch blocks that only set state without logging
   - Promise rejections with no handler

**Verification**: Before flagging a catch block that only sets state (e.g., `setError(message)`), check if the component's error state triggers a visible error display to the user. UI-rendered errors are a valid handling strategy in client components.

### Phase 7: Report

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Error Boundary, Promise Handling, API Response, Validation, Recovery, or Logging
3. **Location**: Exact file path and line reference
4. **Description**: What the error handling gap is
5. **Impact**: What happens when this error path is triggered in production
6. **Remediation**: Specific code pattern to fix the issue

Provide an overall summary:

- Total findings by severity and category
- Error handling coverage assessment (boundaries, async, API, validation)
- Top 3 most critical gaps to address
- Systemic patterns that need architectural fixes (e.g., missing global error handler)
- Positive patterns: well-handled error paths worth preserving

## Severity Classification

| Severity | Criteria | Example |
| -------- | -------- | ------- |
| **Critical** | Unhandled rejection on production-critical path, no root error boundary | Async payment handler without try/catch, no `error.tsx` at root |
| **High** | Leaked stack trace or internal details to client, empty catch on data mutation | API route returning `{ error: err.stack }` to the browser |
| **Medium** | Inconsistent error format across API routes, catch with only console.error | Half the API returns `{ error }`, half returns `{ message, code }` |
| **Low** | Missing error boundary on non-critical component, no retry on transient failure | Optional analytics call without retry logic |
| **Informational** | Error message could be more actionable, logging could include more context | "Something went wrong" instead of "Failed to load repository — check the URL" |

## Example Output

````markdown
### Finding: Leaked Stack Trace in API Response

- **Severity**: High
- **Category**: API Response
- **Location**: `app/api/chat/route.ts` line 47
- **Description**: The catch block in the POST handler returns the full error object to the client:
  ```ts
  catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  ```
  When an internal error occurs (database connection failure, AI provider timeout), `error.message` may contain internal service URLs, connection strings, or stack trace fragments that expose infrastructure details.
- **Impact**: Attackers can use leaked error details to map internal infrastructure, identify technology versions, and craft targeted attacks. Internal paths and connection strings are especially valuable for lateral movement.
- **Remediation**: Return a generic message to the client and log the full error server-side:
  ```ts
  catch (error) {
    console.error("[POST /api/chat] Error:", error);
    return Response.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
  ```
````

## Common False Positives

Skip or downgrade these patterns — they look like error handling gaps but are acceptable:

1. **Test code intentionally throwing**: Test files that use `expect(() => fn()).toThrow()` or `await expect(promise).rejects.toThrow()` are testing error paths by design
2. **Development-only error logging**: `console.error` in development mode or behind `process.env.NODE_ENV === 'development'` checks is expected for DX
3. **Framework error propagation**: In Next.js App Router, throwing in a server component is caught by the nearest `error.tsx` — the component itself does not need try/catch
4. **Error-first callbacks**: Node.js callback patterns like `(err, result) => {}` check `err` at the call site, not in the function definition
5. **Intentional rethrow with enrichment**: `catch (e) { throw new CustomError('context', { cause: e }); }` is valid error enrichment, not useless catch-rethrow
6. **Validation libraries handling errors**: When using zod's `.safeParse()` or similar, the library returns errors as values — no try/catch needed

## Related Skills

- For security implications of error data exposure, load `security-audit`
- For API error response format and status code consistency, load `api-design-review`
- For testing error paths and edge cases, load `testing-quality`
