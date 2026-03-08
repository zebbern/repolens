---
id: security-audit
name: Security Audit
description: OWASP Top 10 security vulnerability analysis with severity classification, data-flow tracing, and actionable remediation. Detects injection, broken access control, cryptographic failures, SSRF, and misconfigurations.
trigger: When asked to review security, find vulnerabilities, or audit code safety
relatedTools:
  - scanIssues
  - readFile
  - searchFiles
lastReviewed: "2026-03-08"
reviewCycleDays: 180
standardsReferenced:
  - name: OWASP Top 10
    pinnedVersion: "2021"
  - name: CWE Top 25
    pinnedVersion: "2024"
---

# Security Audit

## Purpose

Performs a structured security audit of the codebase using the OWASP Top 10 (2021 edition) framework. The analysis traces data flow from user input to sink functions, classifies findings by severity using impact × likelihood scoring, and provides specific remediation guidance. The user receives a prioritized list of vulnerabilities with exact file locations, exploit scenarios, and code-level fixes.

## Prerequisites

Ensure the `scanIssues` tool is available before proceeding. If not available, fall back to manual code review using `readFile` and `searchFiles`. The `getProjectOverview` tool provides essential context for understanding the tech stack.

## Methodology

Follow this structured approach for every security audit. Complete each phase in order.

### Phase 1: Reconnaissance

1. Call `getProjectOverview` to understand the tech stack and dependencies
2. Use `searchFiles` to locate authentication, authorization, and session management code:
   - Search for patterns: `auth`, `session`, `jwt`, `token`, `password`, `secret`, `cookie`
3. Use `searchFiles` to find entry points and API routes:
   - Search for patterns: `route`, `handler`, `endpoint`, `middleware`
4. Read `package.json` or equivalent to check for known vulnerable dependencies

### Phase 2: OWASP Top 10 (2021 Edition) Analysis

For each category, use the appropriate tools to investigate. Apply chain-of-thought verification: **trace the data flow from user input through processing to the point of use before confirming exploitability.**

#### A01 — Broken Access Control

- Search for authorization checks in route handlers
- Verify that every protected endpoint checks user permissions
- Look for IDOR vulnerabilities: are resource IDs validated against user ownership?
- Check for missing CORS configuration
- **Verify**: Before flagging missing auth, confirm the route is not intentionally public (e.g., health checks, static assets, login endpoints)

#### A02 — Cryptographic Failures

- Search for hardcoded secrets, API keys, or credentials
- Check if sensitive data is encrypted at rest and in transit
- Verify password hashing uses strong algorithms (bcrypt, argon2)
- **Verify**: Before flagging a hardcoded string as a secret, confirm it is not a test fixture, placeholder, or public identifier

#### A03 — Injection

- Look for SQL query construction with string concatenation
- Check for unsanitized user input in HTML output (XSS)
- Search for command execution with user-controlled input
- Verify parameterized queries or ORM usage
- **Verify**: Before flagging injection, trace whether the input actually reaches a sink function (database query, `exec`, `innerHTML`, `dangerouslySetInnerHTML`). If the framework auto-escapes (e.g., JSX in React/Next.js), note as informational only

#### A04 — Insecure Design

- Review authentication flow for design weaknesses
- Check rate limiting on sensitive endpoints
- Verify input validation at system boundaries

#### A05 — Security Misconfiguration

- Check for debug mode enabled in production configs
- Look for overly permissive CORS settings (`origin: *` on authenticated endpoints)
- Verify security headers (CSP, X-Frame-Options, etc.)

#### A06 — Vulnerable Components

- Run `scanIssues` on key files to detect known vulnerabilities
- Cross-reference dependency versions against known CVEs

#### A07 — Authentication Failures

- Check password policies and brute-force protection
- Verify session management (expiry, rotation, invalidation)
- Look for credential exposure in logs or error messages

#### A08 — Data Integrity Failures

- Check for unsigned or unverified serialized data
- Verify CI/CD pipeline security

#### A09 — Logging & Monitoring Failures

- Check if security events are logged (login attempts, access denials)
- Verify sensitive data is NOT logged (passwords, tokens, PII)

#### A10 — SSRF

- Search for server-side HTTP requests with user-controlled URLs
- Check for URL validation and allowlisting
- **Verify**: Confirm the URL parameter is actually user-controlled, not hardcoded or derived from internal config

### Phase 3: Reporting

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Which OWASP Top 10 (2021) category it falls under
3. **Location**: Exact file path and line reference
4. **Description**: What the vulnerability is
5. **Impact**: What an attacker could do
6. **Remediation**: Specific code changes to fix it
7. **Confidence**: High / Medium / Low — based on whether the full data flow was verified

### Phase 4: Summary

Provide an overall security posture assessment:

- Total findings by severity
- Top 3 most critical issues to address immediately
- Systemic patterns that need architectural changes
- Positive security practices already in place

## Severity Classification

| Severity | Impact | Likelihood | Criteria | Example |
| -------- | ------ | ---------- | -------- | ------- |
| **Critical** | System compromise | Exploitable without auth | RCE, auth bypass, data breach of all users | Unsanitized `exec()` with user input |
| **High** | Data exposure / privilege escalation | Exploitable with low-privilege auth | SQL injection, IDOR on sensitive data, stored XSS | Missing ownership check on API resource |
| **Medium** | Limited data exposure / degraded security | Requires specific conditions | Reflected XSS, CSRF on non-critical action, weak hashing | Using MD5 for password hashing |
| **Low** | Minimal direct impact | Unlikely or requires chaining | Missing security headers, verbose error messages | Stack traces exposed in production |
| **Informational** | No direct impact | N/A | Best practice improvement, defense-in-depth | Missing rate limiting on public search |

## Example Output

````markdown
### Finding: Unvalidated Resource Access (IDOR)

- **Severity**: High
- **Confidence**: High
- **Category**: A01 — Broken Access Control
- **Location**: `app/api/repos/[id]/route.ts` line 23
- **Description**: The GET handler retrieves a repository by ID from the URL parameter without verifying the authenticated user has access to that repository. Any authenticated user can read any repository's data by guessing or enumerating IDs.
- **Impact**: Authenticated users can access private repository data belonging to other users, including source code, commit history, and configuration.
- **Remediation**: Add an ownership check after fetching the resource:
  ```ts
  const repo = await getRepo(params.id);
  if (repo.ownerId !== session.userId) {
    return new Response("Forbidden", { status: 403 });
  }
  ```
````

## Common False Positives

Skip or downgrade these patterns — they are frequently flagged but rarely exploitable:

1. **Test files and mock data**: Hardcoded tokens, passwords, or API keys in `*.test.*`, `*.spec.*`, `__tests__/`, or `test/` directories are test fixtures, not real credentials
2. **Intentional example credentials**: Strings like `"test-api-key"`, `"password123"` in example configs, seed scripts, or documentation are placeholders
3. **Framework-handled escaping**: In React/Next.js, JSX expressions are auto-escaped by the framework. Only flag XSS when `dangerouslySetInnerHTML` or raw `innerHTML` is used with user input
4. **Environment variable references**: Code that reads `process.env.SECRET_KEY` is not a hardcoded secret — the actual value is injected at runtime
5. **Public API endpoints**: Routes like `/api/health`, `/api/status`, or authentication endpoints (`/api/auth/login`) are intentionally unauthenticated

## Related Skills

- For architecture-level security concerns (dependency direction, layer isolation), load `architecture-analysis`
- For dependency vulnerability scanning, the `scanIssues` tool provides automated CVE detection
