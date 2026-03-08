---
id: security-audit
name: Security Audit
description: Structured methodology for security vulnerability analysis using OWASP Top 10
trigger: When asked to review security, find vulnerabilities, or audit code safety
relatedTools:
  - scanIssues
  - readFile
  - searchFiles
---

## Prerequisites

Ensure the `scanIssues` tool is available before proceeding. If not available, fall back to manual code review using `readFile` and `searchFiles`.

## Methodology

Follow this structured approach for every security audit. Complete each phase in order.

### Phase 1: Reconnaissance

1. Call `getProjectOverview` to understand the tech stack and dependencies
2. Use `searchFiles` to locate authentication, authorization, and session management code:
   - Search for patterns: `auth`, `session`, `jwt`, `token`, `password`, `secret`, `cookie`
3. Use `searchFiles` to find entry points and API routes:
   - Search for patterns: `route`, `handler`, `endpoint`, `middleware`
4. Read `package.json` or equivalent to check for known vulnerable dependencies

### Phase 2: OWASP Top 10 Analysis

For each category, use the appropriate tools to investigate:

**A01 — Broken Access Control**
- Search for authorization checks in route handlers
- Verify that every protected endpoint checks user permissions
- Look for IDOR vulnerabilities: are resource IDs validated against user ownership?
- Check for missing CORS configuration

**A02 — Cryptographic Failures**
- Search for hardcoded secrets, API keys, or credentials
- Check if sensitive data is encrypted at rest and in transit
- Verify password hashing uses strong algorithms (bcrypt, argon2)

**A03 — Injection**
- Look for SQL query construction with string concatenation
- Check for unsanitized user input in HTML output (XSS)
- Search for command execution with user-controlled input
- Verify parameterized queries or ORM usage

**A04 — Insecure Design**
- Review authentication flow for design weaknesses
- Check rate limiting on sensitive endpoints
- Verify input validation at system boundaries

**A05 — Security Misconfiguration**
- Check for debug mode enabled in production configs
- Look for overly permissive CORS settings
- Verify security headers (CSP, X-Frame-Options, etc.)

**A06 — Vulnerable Components**
- Run `scanIssues` on key files to detect known vulnerabilities
- Cross-reference dependency versions against known CVEs

**A07 — Authentication Failures**
- Check password policies and brute-force protection
- Verify session management (expiry, rotation, invalidation)
- Look for credential exposure in logs or error messages

**A08 — Data Integrity Failures**
- Check for unsigned or unverified serialized data
- Verify CI/CD pipeline security

**A09 — Logging & Monitoring Failures**
- Check if security events are logged (login attempts, access denials)
- Verify sensitive data is NOT logged (passwords, tokens, PII)

**A10 — SSRF**
- Search for server-side HTTP requests with user-controlled URLs
- Check for URL validation and allowlisting

### Phase 3: Reporting

For each finding, report:
1. **Severity**: Critical / High / Medium / Low / Informational
2. **Category**: Which OWASP category it falls under
3. **Location**: Exact file path and line reference
4. **Description**: What the vulnerability is
5. **Impact**: What an attacker could do
6. **Remediation**: Specific code changes to fix it

### Phase 4: Summary

Provide an overall security posture assessment:
- Total findings by severity
- Top 3 most critical issues to address immediately
- Systemic patterns that need architectural changes
- Positive security practices already in place
