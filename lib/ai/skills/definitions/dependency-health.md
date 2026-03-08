---
id: dependency-health
name: Dependency Health
description: Audit project dependencies for outdated packages, known vulnerabilities, license compliance, abandoned maintenance, and supply chain risks
trigger: When asked to check dependencies, find vulnerable packages, audit licenses, assess dependency health, or review supply chain security
relatedTools:
  - readFile
  - searchFiles
  - getProjectOverview
lastReviewed: "2026-03-08"
reviewCycleDays: 180
standardsReferenced:
  - name: SPDX License List
    pinnedVersion: "3.25"
  - name: CVE Database (NVD)
    pinnedVersion: "2024"
---

# Dependency Health

## Purpose

Performs a comprehensive dependency health audit covering vulnerability scanning, maintenance status, license compliance, bundle impact, and supply chain risks. The analysis reads package manifests and lock files, cross-references known CVE patterns, evaluates maintenance signals, and flags licensing conflicts. The user receives a prioritized list of dependency risks with severity classification, affected packages, and specific remediation actions.

## Prerequisites

Ensure the `getProjectOverview` tool is available to determine the package manager and tech stack. The `readFile` tool is required to inspect `package.json`, lock files, and dependency metadata. Use `searchFiles` to locate additional manifest files in monorepo structures.

## Methodology

Follow this structured approach for every dependency health audit. Complete each phase in order.

### Phase 1: Inventory

1. Call `getProjectOverview` to identify the package manager (npm, pnpm, yarn, pip, etc.)
2. Read the primary manifest file (`package.json`, `requirements.txt`, `pyproject.toml`, etc.)
3. Read the lock file (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `poetry.lock`) to determine pinned versions
4. Use `searchFiles` to find additional manifests in workspaces or sub-packages
5. Separate dependencies by category: production, development, peer, optional
6. Note the total dependency count and direct vs. transitive ratio

### Phase 2: Vulnerability Check

1. Search for packages with known CVE patterns by cross-referencing version ranges
2. Check for deprecated packages — search for `deprecated` markers in metadata
3. Identify packages with known security advisories:
   - Search for patterns: `event-stream`, `ua-parser-js`, `colors`, `faker`, `node-ipc` — known supply chain incidents
4. Check that lock file exists and is committed — missing lock files allow version drift
5. Verify that dependency versions use exact or tilde ranges, not wildcards (`*`) or overly broad ranges (`>=`)

**Verification**: Before flagging a CVE, confirm the vulnerable code path is actually reachable from the project's usage of the package. A vulnerability in an unused submodule is informational, not critical.

### Phase 3: Maintenance Assessment

1. For each direct dependency, evaluate maintenance signals:
   - **Last publish date**: available in lock file metadata or registry
   - **Version cadence**: major versions years apart may indicate slow maintenance
   - **Open issues ratio**: search for issue count signals in README badges
2. Look for maintenance red flags in the codebase:
   - Pinned to very old major versions (2+ majors behind latest)
   - README badges showing failing CI
   - Dependencies depending on other unmaintained packages

#### Maintenance Status Thresholds

| Signal | Threshold | Classification |
| -------- | ----------- | --------------- |
| Last publish | > 6 months ago | Stale — investigate maintenance status |
| Last publish | > 12 months ago | Potentially abandoned — seek alternatives |
| Last publish | > 24 months ago | Likely abandoned — plan migration |
| Major version behind | 1 major | Monitor for breaking changes |
| Major version behind | 2+ majors | Outdated — upgrade or replace |
| Open issues with < 5 maintainer responses | > 100 issues | Maintenance concern |

**Verification**: Before flagging a package as abandoned, check if it is feature-complete and stable by design (e.g., `inherits`, `ms`, `escape-html`). Some packages are intentionally finished — no updates needed.

### Phase 4: License Compliance

1. Read license fields from `package.json` and lock file metadata
2. Classify licenses by compatibility:
   - **Permissive**: MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0 — safe for all use
   - **Weak copyleft**: LGPL-2.1, LGPL-3.0, MPL-2.0 — safe if not modified, requires disclosure if modified
   - **Strong copyleft**: GPL-2.0, GPL-3.0, AGPL-3.0 — requires derivative work to use the same license
   - **Unknown / UNLICENSED**: No license declared — legally risky, cannot safely use
3. Flag copyleft licenses in commercial or proprietary projects
4. Flag packages with no license declaration

**Verification**: Before flagging a license conflict, confirm the dependency is used in production code, not only in dev tooling. Copyleft licenses on dev-only dependencies (linters, test frameworks) typically pose no risk.

### Phase 5: Bundle Impact

1. Identify the largest dependencies by checking for known heavy packages:
   - `moment` → suggest `date-fns` or `dayjs`
   - `lodash` (full import) → suggest `lodash-es` or individual imports
   - `@fortawesome/fontawesome-free` → suggest `lucide-react` or individual SVGs
   - `aws-sdk` (v2 full) → suggest `@aws-sdk/client-*` (v3 modular)
2. Check for dependencies that duplicate functionality:
   - Multiple date libraries, multiple HTTP clients, multiple validation libraries
3. Look for large dependencies that could be lazy-loaded or dynamically imported
4. Check `devDependencies` that mistakenly appear in `dependencies`

**Verification**: Before flagging bundle impact, confirm the dependency is used in client-side code. Server-only dependencies do not affect bundle size in frameworks like Next.js.

### Phase 6: Supply Chain Risk

1. Check for typosquatting risk — packages with names very similar to popular packages
2. Verify install scripts: search for `preinstall`, `postinstall`, `prepare` scripts in dependencies
3. Look for dependencies that pull from non-standard registries
4. Check for packages with extremely low download counts paired with broad access scopes
5. Verify that the lock file integrity hashes are present

**Verification**: Before flagging supply chain risk, confirm the package is not a legitimate fork, organization-scoped package, or well-known alternative name.

### Phase 7: Report

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Vulnerability, Maintenance, License, Bundle Impact, or Supply Chain
3. **Package**: The affected dependency name and version
4. **Description**: What the risk is
5. **Impact**: What could go wrong if unaddressed
6. **Remediation**: Specific action — upgrade, replace, remove, or pin

Provide an overall summary:

- Total findings by severity and category
- Dependency health score heuristic (Critical=0 is baseline)
- Top 3 most urgent actions
- Quick wins (unused deps to remove, easy upgrades)
- Positive signals: well-maintained core dependencies, good pinning practices

## Severity Classification

| Severity | Criteria | Example |
| ---------- | ---------- | --------- |
| **Critical** | Known CVE in direct production dependency with reachable code path | `ws` < 8.17.1 with ReDoS in header parsing |
| **High** | Abandoned package (>24 months) with no maintained alternative in use, or strong copyleft license in commercial project | Using GPL-3.0 library in proprietary SaaS |
| **Medium** | Outdated major version (2+ behind), stale package (6-12 months), or duplicate functionality | Both `axios` and `node-fetch` in the same project |
| **Low** | Missing lock file pinning, overly broad version ranges, or dev dependency with minor issue | `"lodash": "^4"` without lock file committed |
| **Informational** | Bundle optimization opportunity, alternative suggestion | `moment` could be replaced with `date-fns` for 70% size reduction |

## Example Output

````markdown
### Finding: Known Vulnerability in Production Dependency

- **Severity**: Critical
- **Category**: Vulnerability
- **Package**: `jsonwebtoken@8.5.1`
- **Description**: `jsonwebtoken` versions before 9.0.0 are affected by CVE-2022-23529, allowing attackers to forge JWTs when the `secretOrPublicKey` parameter is improperly validated. This package is imported directly in `lib/auth/verify-token.ts`.
- **Impact**: An attacker could craft a malicious JWT that passes verification, gaining unauthorized access to protected API routes. All authenticated endpoints are affected.
- **Remediation**: Upgrade to `jsonwebtoken@9.0.0` or later:
  ```bash
  pnpm update jsonwebtoken@^9.0.0
  ```
  After upgrading, verify that the `algorithms` option is explicitly set in `jwt.verify()` calls to prevent algorithm confusion attacks.
```

## Common False Positives

Skip or downgrade these patterns — they are frequently flagged but rarely exploitable:

1. **Dev-only dependencies**: Vulnerabilities in `devDependencies` (test frameworks, linters, build tools) do not affect production unless the dev dependency is accidentally bundled
2. **Peer dependency warnings**: Peer dependency version mismatches from `npm install` warnings are usually harmless when the host package functions correctly
3. **Optional dependencies**: Packages in `optionalDependencies` that fail to install are expected behavior — they are fallbacks, not requirements
4. **Type-only packages**: `@types/*` packages are erased at build time and have zero runtime impact regardless of their version
5. **Feature-complete packages**: Stable, small-scope packages like `ms`, `escape-html`, or `inherits` with no recent updates are finished, not abandoned
6. **Transitive-only vulnerabilities**: A CVE in a sub-dependency that is not reachable through the direct dependency's API surface is typically informational

## Related Skills

- For vulnerability exploitation assessment and OWASP classification, load `security-audit`
- For bundle size impact on Core Web Vitals, load `performance-analysis`
- For architectural implications of replacing dependencies, load `architecture-analysis`
