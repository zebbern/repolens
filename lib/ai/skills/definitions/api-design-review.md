---
id: api-design-review
name: API Design Review
description: Review API endpoint consistency, naming conventions, error response patterns, pagination, and authentication enforcement
trigger: When asked to review API design, check endpoint consistency, audit REST patterns, or validate API contracts
relatedTools:
  - searchFiles
  - readFile
  - scanIssues
---

## Purpose

Reviews API endpoints for consistency, security, and developer experience by auditing naming conventions, HTTP method usage, error response formats, pagination patterns, and authentication enforcement. The analysis compares endpoints against each other to find inconsistencies, then validates each against REST best practices. The user receives a prioritized list of API design issues with exact locations and specific remediation.

## Prerequisites

Ensure the `searchFiles` and `readFile` tools are available before proceeding. The `scanIssues` tool is used for detecting known vulnerability patterns in API code. The `getProjectOverview` tool provides essential context for identifying the API framework and routing conventions.

## Methodology

Follow this structured approach for API design review. Complete each phase in order.

### Phase 1: API Discovery

1. Call `getProjectOverview` to understand the routing framework:
   - Next.js App Router: `app/api/**/route.ts`
   - Next.js Pages Router: `pages/api/**/*.ts`
   - Express/Fastify: search for `router.get`, `router.post`, `app.get`, `app.post`
2. Use `searchFiles` to locate all API route files and build a route inventory
3. For each route, identify:
   - URL path and pattern (e.g., `/api/repos/[id]`)
   - HTTP methods handled (GET, POST, PUT, PATCH, DELETE)
   - Resource name (e.g., `repos`, `users`, `changelog`)
4. Group routes by resource to identify the API surface area
5. Read 3-5 representative route files to understand the common patterns in use

### Phase 2: Naming & Convention Consistency

1. Check URL path naming:
   - Plural nouns for collections: `/api/repos` not `/api/repo`
   - Consistent casing: kebab-case preferred (`/api/user-settings` not `/api/userSettings`)
   - Resource nesting: `/api/repos/[id]/commits` not `/api/repo-commits`
2. Check HTTP method usage:
   - GET for retrieval (no side effects)
   - POST for creation
   - PUT/PATCH for updates (PUT = full replace, PATCH = partial)
   - DELETE for removal
3. Check for action-based URLs that should be resource-based:
   - Flag: `/api/getUser`, `/api/deleteRepo`, `/api/createChangelog`
   - Prefer: `GET /api/users/[id]`, `DELETE /api/repos/[id]`, `POST /api/changelogs`
4. Check for consistency across routes:
   - Do all routes follow the same naming pattern?
   - Are URL parameters named consistently (`[id]` vs `[repoId]` vs `[slug]`)?

**Verification**: Before flagging naming issues, check if the API is intentionally RPC-style (e.g., `/api/chat`, `/api/analyze`) for operations that don't map to CRUD on a resource. These are acceptable.

### Phase 3: Request & Response Patterns

1. Read route handlers and check input validation:
   - Are request bodies validated before processing?
   - Are query parameters validated and typed?
   - Are URL parameters validated (existence, format)?
2. Check error response consistency:
   - Do all routes use the same error response shape?
   - Are HTTP status codes used correctly?
   - Are error messages actionable and safe (no stack traces, internal details)?
3. Build an error format inventory — document each distinct error shape:
   ```
   Route A: { error: string }
   Route B: { message: string, code: number }
   Route C: { error: { message: string, details: object } }
   ```

**Expected error response format** (single consistent shape):
```json
{
  "error": {
    "message": "Human-readable description",
    "code": "MACHINE_READABLE_CODE"
  }
}
```

**Status code usage:**

| Status Code | Usage | Common Mistakes |
|-------------|-------|-----------------|
| 200 | Successful retrieval or update | Using 200 for creation (should be 201) |
| 201 | Successful creation | Missing on POST endpoints that create resources |
| 204 | Successful deletion (no body) | Returning 200 with empty body instead |
| 400 | Client error — invalid input | Using 500 for validation failures |
| 401 | Not authenticated | Confusing with 403 |
| 403 | Not authorized (authenticated but lacks permission) | Confusing with 401 |
| 404 | Resource not found | Returning 200 with null body instead |
| 422 | Validation error (valid JSON, invalid semantics) | Using 400 for all client errors |
| 429 | Rate limited | Missing entirely |
| 500 | Server error | Returning 500 for client input errors |

**Quantitative Thresholds**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Distinct error response formats across routes | > 3 | Flag inconsistency — standardize |
| Distinct error response formats across routes | 2-3 | Review for unification |
| Distinct error response formats across routes | 1 | Consistent — healthy |
| Route with no input validation | Always flag | Add validation at boundary |
| Route returning 200 for all responses (success and error) | Always flag | Use appropriate status codes |

### Phase 4: Authentication & Authorization

1. Identify the auth middleware or pattern:
   - Search for: `getSession`, `getServerSession`, `auth()`, `middleware`, `withAuth`
2. For each route, verify auth enforcement:
   - Is authentication checked before processing?
   - Is authorization verified (does the user have access to *this* resource)?
   - Are there routes that should be protected but aren't?
3. Check for consistent auth patterns:
   - Do all protected routes use the same auth check?
   - Is the auth check at the start of the handler (not after partial processing)?
4. Check for rate limiting on sensitive endpoints:
   - Login/auth endpoints
   - Resource creation endpoints
   - Endpoints that trigger expensive operations (AI, email, etc.)

**Quantitative Thresholds**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Non-public route missing auth check | > 0 | Critical — add auth immediately |
| Protected routes using different auth methods | > 1 method | Flag inconsistency — standardize |
| Sensitive endpoint without rate limiting | Any | Flag — add rate limiting |

**Verification**: Before flagging missing auth, confirm the route is not intentionally public. Common intentional public routes: health checks, login/register endpoints, OAuth callbacks, webhook receivers, public data endpoints (e.g., landing page content).

### Phase 5: Data Patterns

1. Check pagination on list endpoints:
   - Does `GET /api/resources` support pagination?
   - Is there a maximum page size enforced server-side?
   - Is the pagination format consistent (offset vs cursor, parameter names)?
2. Check for unbounded responses:
   - Endpoints returning all records without limit
   - Nested includes that expand response size (e.g., returning all comments with all posts)
3. Check filtering and sorting:
   - Are query parameters for filtering validated against allowed fields?
   - Is sort direction constrained (`asc`/`desc` only)?
4. Check response payload efficiency:
   - Are endpoints returning unnecessary fields? (e.g., returning user password hash)
   - Is there a way to request partial responses (field selection)?
5. Check for versioning strategy if multiple API versions coexist

**Quantitative Thresholds**

| Metric | Threshold | Action |
|--------|-----------|--------|
| List endpoint returning > 100 items without pagination | Always flag | Add pagination with server-enforced max |
| Query parameters without validation | > 5 per route | Flag — add validation |
| Endpoint returning sensitive fields (password, token, secret) | > 0 | Critical — remove from response |
| List endpoint without max page size | Always flag | Enforce server-side cap (e.g., 100) |

### Phase 6: Report

For each finding, report:
1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Naming, Consistency, Validation, Auth, or Data Patterns
3. **Location**: Exact file path and line reference
4. **Description**: What the API design issue is
5. **Impact**: How this affects consumers, security, or performance
6. **Remediation**: Specific change with before/after example
7. **Affected Routes**: Count of routes with the same issue (for systemic problems)

Provide an overall summary:
- Total API routes reviewed
- Findings by severity and category
- Consistency score: are patterns uniform or fragmented?
- Top 3 issues to address first (prioritize auth and security)
- Positive patterns: well-designed endpoints to use as templates

## Severity Classification

| Severity | Criteria | Example |
|----------|----------|---------|
| **Critical** | Missing auth on protected endpoint, sensitive data exposure in response | `GET /api/users/[id]` returns password hash, no auth check |
| **High** | Inconsistent error format across > 3 routes, missing input validation on mutation endpoint | POST handler processes body without validation, 5 different error shapes |
| **Medium** | Missing pagination on list endpoint, naming convention violations | `GET /api/repos` returns all 5000 repos without limit |
| **Low** | Minor naming inconsistency, missing 204 on DELETE | `/api/user-settings` vs `/api/userPreferences` casing mismatch |
| **Informational** | Style suggestion, API documentation gap | Could add OpenAPI schema for auto-documentation |

## Example Output

```
### Finding: Missing Pagination — `GET /api/repos`

- **Severity**: Medium
- **Category**: Data Patterns
- **Location**: `app/api/repos/route.ts` line 12
- **Description**: The GET handler returns all repositories for the authenticated user without pagination. The query `db.repo.findMany({ where: { ownerId } })` has no `take` or `skip` parameters, and the route accepts no `page` or `limit` query parameters.
- **Impact**: Users with many repositories (100+) receive increasingly large payloads, causing slow response times and high memory usage. API consumers cannot efficiently page through results.
- **Affected Routes**: 3 other list endpoints have the same issue (`/api/changelogs`, `/api/tours`, `/api/docs`)
- **Remediation**: Add cursor-based or offset pagination:
  ```ts
  // Before
  const repos = await db.repo.findMany({ where: { ownerId } });
  return Response.json(repos);

  // After
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 20));
  const repos = await db.repo.findMany({
    where: { ownerId },
    take: limit,
    skip: (page - 1) * limit,
    orderBy: { createdAt: 'desc' },
  });
  const total = await db.repo.count({ where: { ownerId } });
  return Response.json({ data: repos, pagination: { page, limit, total } });
  ```
```

## Common False Positives

Skip or downgrade these patterns — they are valid API design choices:

1. **Internal-only endpoints**: APIs consumed exclusively by the same application's frontend may use simplified patterns (e.g., no versioning, relaxed naming) — flag as informational only
2. **Webhook receivers**: Incoming webhook endpoints from external services (Stripe, GitHub) follow the sender's conventions, not yours. Don't flag their URL structure or payload format
3. **SSR data routes**: In Next.js, server actions and server components that look like API calls are internal data-fetching mechanisms, not public APIs. Evaluate them differently
4. **Health check and status endpoints**: `/api/health`, `/api/status` are intentionally simple (no auth, no pagination, no standard error format). Skip them
5. **RPC-style endpoints for non-CRUD operations**: Actions like `/api/chat`, `/api/analyze`, `/api/export` don't map to REST resources — they're valid RPC endpoints. Judge them on input validation and error handling, not REST naming

## Related Skills

- For security-focused auth enforcement review, load `security-audit`
- For performance analysis of slow endpoints and query optimization, load `performance-analysis`
- For understanding which API routes change most frequently, load `git-analysis`
