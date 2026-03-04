// Compliance matrix — maps scanner rules to OWASP Top 10 2025 and CWE Top 25 2024
// standards, calculates coverage, and generates compliance reports.

import type { CodeIssue, ScanRule, ScanResults } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceStandard = 'owasp-top-10-2025' | 'cwe-top-25-2024'

export interface ComplianceItem {
  id: string
  name: string
  description: string
  /** CWE IDs that map to this compliance item */
  cwes: string[]
  severity: 'critical' | 'high' | 'medium' | 'low'
}

export interface ComplianceCoverageItem {
  item: ComplianceItem
  isCovered: boolean
  matchingRuleIds: string[]
  issueCount: number
}

export interface ComplianceCoverage {
  standard: ComplianceStandard
  items: ComplianceCoverageItem[]
  coveredCount: number
  totalCount: number
  coveragePercent: number
}

export interface ComplianceCategory {
  name: string
  description: string
  covered: boolean
  ruleCount: number
  findingCount: number
  ruleIds: string[]
  status: 'pass' | 'warn' | 'fail' | 'no-coverage'
}

export interface ComplianceReport {
  owaspCoverage: Record<string, ComplianceCategory>
  cweCoverage: Record<string, ComplianceCategory>
  overallOwaspPercent: number
  overallCwePercent: number
  generatedAt: string
}

// ---------------------------------------------------------------------------
// OWASP Top 10 2025 — static data
// ---------------------------------------------------------------------------

export const OWASP_TOP_10_2025: ComplianceItem[] = [
  {
    id: 'A01',
    name: 'Broken Access Control',
    description:
      'Failures related to access control enforcement, allowing users to act outside intended permissions. Includes IDOR, missing authorization, CORS misconfiguration, and path traversal.',
    cwes: ['CWE-22', 'CWE-284', 'CWE-285', 'CWE-639', 'CWE-601', 'CWE-352', 'CWE-862', 'CWE-863', 'CWE-942', 'CWE-1275', 'CWE-1385'],
    severity: 'critical',
  },
  {
    id: 'A02',
    name: 'Cryptographic Failures',
    description:
      'Failures related to cryptography which expose sensitive data. Includes weak algorithms, hardcoded keys, missing encryption, insecure random, and timing attacks.',
    cwes: ['CWE-259', 'CWE-321', 'CWE-326', 'CWE-327', 'CWE-328', 'CWE-330', 'CWE-338', 'CWE-347', 'CWE-565', 'CWE-598', 'CWE-208', 'CWE-614'],
    severity: 'critical',
  },
  {
    id: 'A03',
    name: 'Injection',
    description:
      'User-supplied data is sent to an interpreter as part of a command or query. Includes SQL injection, XSS, command injection, SSTI, prototype pollution, and ReDoS.',
    cwes: ['CWE-79', 'CWE-89', 'CWE-78', 'CWE-94', 'CWE-77', 'CWE-1321', 'CWE-1333', 'CWE-1336', 'CWE-134', 'CWE-98', 'CWE-20'],
    severity: 'critical',
  },
  {
    id: 'A04',
    name: 'Insecure Design',
    description:
      'Missing or ineffective security controls at the design level. Includes missing input validation, insufficient error handling, TOCTOU race conditions, and file upload vulnerabilities.',
    cwes: ['CWE-209', 'CWE-256', 'CWE-501', 'CWE-367', 'CWE-434', 'CWE-915'],
    severity: 'high',
  },
  {
    id: 'A05',
    name: 'Security Misconfiguration',
    description:
      'Insecure default configurations, incomplete configurations, open cloud storage, verbose error messages, and unnecessary features enabled.',
    cwes: ['CWE-16', 'CWE-611', 'CWE-614', 'CWE-489', 'CWE-693', 'CWE-770', 'CWE-290', 'CWE-1004', 'CWE-200', 'CWE-215', 'CWE-400'],
    severity: 'high',
  },
  {
    id: 'A06',
    name: 'Vulnerable and Outdated Components',
    description:
      'Using components with known vulnerabilities, or components that are no longer maintained. Includes deprecated libraries and functions.',
    cwes: ['CWE-1104', 'CWE-120'],
    severity: 'high',
  },
  {
    id: 'A07',
    name: 'Identification and Authentication Failures',
    description:
      'Failures related to confirming user identity, authentication, and session management. Includes hardcoded credentials, session fixation, and weak JWT handling.',
    cwes: ['CWE-287', 'CWE-798', 'CWE-307', 'CWE-384', 'CWE-306'],
    severity: 'critical',
  },
  {
    id: 'A08',
    name: 'Software and Data Integrity Failures',
    description:
      'Code and infrastructure that does not protect against integrity violations. Includes insecure deserialization, CI/CD pipeline vulnerabilities, and auto-updates without integrity verification.',
    cwes: ['CWE-502', 'CWE-829'],
    severity: 'high',
  },
  {
    id: 'A09',
    name: 'Security Logging and Monitoring Failures',
    description:
      'Insufficient logging, monitoring, and alerting. Without proper logging, breaches cannot be detected and investigated. Includes log injection and sensitive data in logs.',
    cwes: ['CWE-778', 'CWE-117', 'CWE-532'],
    severity: 'medium',
  },
  {
    id: 'A10',
    name: 'Server-Side Request Forgery',
    description:
      'SSRF flaws occur when a web application fetches a remote resource without validating the user-supplied URL. Attackers can force the server to make requests to internal services.',
    cwes: ['CWE-918'],
    severity: 'critical',
  },
]

// ---------------------------------------------------------------------------
// CWE Top 25 2024 — static data
// ---------------------------------------------------------------------------

export const CWE_TOP_25_2024: ComplianceItem[] = [
  {
    id: 'CWE-79',
    name: 'Cross-site Scripting (XSS)',
    description: 'Improper neutralization of input during web page generation, allowing script injection.',
    cwes: ['CWE-79'],
    severity: 'critical',
  },
  {
    id: 'CWE-787',
    name: 'Out-of-bounds Write',
    description: 'Software writes data past the end, or before the beginning, of the intended buffer.',
    cwes: ['CWE-787'],
    severity: 'critical',
  },
  {
    id: 'CWE-89',
    name: 'SQL Injection',
    description: 'Improper neutralization of special elements used in SQL commands.',
    cwes: ['CWE-89'],
    severity: 'critical',
  },
  {
    id: 'CWE-352',
    name: 'Cross-Site Request Forgery (CSRF)',
    description: 'Web application does not verify that a request was intentionally provided by the authenticated user.',
    cwes: ['CWE-352'],
    severity: 'high',
  },
  {
    id: 'CWE-22',
    name: 'Path Traversal',
    description: 'Improper limitation of a pathname to a restricted directory.',
    cwes: ['CWE-22'],
    severity: 'high',
  },
  {
    id: 'CWE-125',
    name: 'Out-of-bounds Read',
    description: 'Software reads data past the end, or before the beginning, of the intended buffer.',
    cwes: ['CWE-125'],
    severity: 'high',
  },
  {
    id: 'CWE-78',
    name: 'OS Command Injection',
    description: 'Improper neutralization of special elements used in OS commands.',
    cwes: ['CWE-78'],
    severity: 'critical',
  },
  {
    id: 'CWE-416',
    name: 'Use After Free',
    description: 'Referencing memory after it has been freed, causing data corruption or code execution.',
    cwes: ['CWE-416'],
    severity: 'critical',
  },
  {
    id: 'CWE-862',
    name: 'Missing Authorization',
    description: 'Software does not perform an authorization check when an actor accesses a resource.',
    cwes: ['CWE-862'],
    severity: 'high',
  },
  {
    id: 'CWE-434',
    name: 'Unrestricted Upload of File with Dangerous Type',
    description: 'Software allows the upload of dangerous file types without proper validation.',
    cwes: ['CWE-434'],
    severity: 'high',
  },
  {
    id: 'CWE-94',
    name: 'Code Injection',
    description: 'Improper control of generation of code, allowing injection of executable code.',
    cwes: ['CWE-94'],
    severity: 'critical',
  },
  {
    id: 'CWE-20',
    name: 'Improper Input Validation',
    description: 'Software does not validate or insufficiently validates input before processing.',
    cwes: ['CWE-20'],
    severity: 'high',
  },
  {
    id: 'CWE-77',
    name: 'Command Injection',
    description: 'Improper neutralization of special elements used in a command.',
    cwes: ['CWE-77'],
    severity: 'critical',
  },
  {
    id: 'CWE-287',
    name: 'Improper Authentication',
    description: 'Software does not sufficiently verify that a claim of identity is correct.',
    cwes: ['CWE-287'],
    severity: 'critical',
  },
  {
    id: 'CWE-269',
    name: 'Improper Privilege Management',
    description: 'Software does not properly assign, modify, track, or check privileges for actors.',
    cwes: ['CWE-269'],
    severity: 'high',
  },
  {
    id: 'CWE-502',
    name: 'Deserialization of Untrusted Data',
    description: 'Deserializing untrusted data without verification can result in code execution.',
    cwes: ['CWE-502'],
    severity: 'critical',
  },
  {
    id: 'CWE-200',
    name: 'Exposure of Sensitive Information',
    description: 'Software exposes sensitive information to an unauthorized actor.',
    cwes: ['CWE-200'],
    severity: 'high',
  },
  {
    id: 'CWE-863',
    name: 'Incorrect Authorization',
    description: 'Software performs an authorization check that does not correctly determine access.',
    cwes: ['CWE-863'],
    severity: 'high',
  },
  {
    id: 'CWE-918',
    name: 'Server-Side Request Forgery (SSRF)',
    description: 'Web application fetches a remote resource without validating the user-supplied URL.',
    cwes: ['CWE-918'],
    severity: 'critical',
  },
  {
    id: 'CWE-119',
    name: 'Improper Restriction of Operations within Memory Buffer',
    description: 'Software performs operations on a memory buffer without proper boundary checks.',
    cwes: ['CWE-119'],
    severity: 'critical',
  },
  {
    id: 'CWE-476',
    name: 'NULL Pointer Dereference',
    description: 'A NULL pointer dereference occurs when an application dereferences a pointer that it expects to be valid but is NULL.',
    cwes: ['CWE-476'],
    severity: 'high',
  },
  {
    id: 'CWE-798',
    name: 'Use of Hard-coded Credentials',
    description: 'Software contains hard-coded credentials for inbound or outbound communication.',
    cwes: ['CWE-798'],
    severity: 'critical',
  },
  {
    id: 'CWE-190',
    name: 'Integer Overflow or Wraparound',
    description: 'Software performs a calculation that can produce an integer overflow or wraparound.',
    cwes: ['CWE-190'],
    severity: 'high',
  },
  {
    id: 'CWE-306',
    name: 'Missing Authentication for Critical Function',
    description: 'Software does not perform authentication for critical functionality.',
    cwes: ['CWE-306'],
    severity: 'critical',
  },
  {
    id: 'CWE-362',
    name: 'Concurrent Execution Using Shared Resource with Improper Synchronization (Race Condition)',
    description: 'Software contains a code sequence that runs concurrently with other code and shares a resource without proper synchronization.',
    cwes: ['CWE-362'],
    severity: 'high',
  },
]

// ---------------------------------------------------------------------------
// Coverage calculation
// ---------------------------------------------------------------------------

/**
 * Returns the static compliance items for the requested standard.
 */
export function getComplianceItems(standard: ComplianceStandard): ComplianceItem[] {
  switch (standard) {
    case 'owasp-top-10-2025':
      return OWASP_TOP_10_2025
    case 'cwe-top-25-2024':
      return CWE_TOP_25_2024
  }
}

/**
 * Returns all available compliance standards.
 */
export function getAllStandards(): ComplianceStandard[] {
  return ['owasp-top-10-2025', 'cwe-top-25-2024']
}

/**
 * Calculate coverage of a compliance standard based on scan issues and rules.
 *
 * For each compliance item, checks if any scanner rules or detected issues have
 * a matching CWE. An item is "covered" if at least one rule exists that can
 * detect weaknesses in that category.
 */
export function calculateCoverage(
  standard: ComplianceStandard,
  issues: CodeIssue[],
  rules: ScanRule[],
): ComplianceCoverage {
  const items = getComplianceItems(standard)
  const coverageItems: ComplianceCoverageItem[] = []
  let coveredCount = 0

  for (const item of items) {
    const matchingRuleIds: string[] = []
    let issueCount = 0

    // Check which rules can detect this compliance item's CWEs
    for (const rule of rules) {
      if (rule.cwe && item.cwes.includes(rule.cwe)) {
        if (!matchingRuleIds.includes(rule.id)) {
          matchingRuleIds.push(rule.id)
        }
      }
    }

    // Count issues that match this compliance item
    for (const issue of issues) {
      if (issue.cwe && item.cwes.includes(issue.cwe)) {
        issueCount++
      }
    }

    const isCovered = matchingRuleIds.length > 0
    if (isCovered) coveredCount++

    coverageItems.push({
      item,
      isCovered,
      matchingRuleIds,
      issueCount,
    })
  }

  return {
    standard,
    items: coverageItems,
    coveredCount,
    totalCount: items.length,
    coveragePercent: items.length > 0 ? Math.round((coveredCount / items.length) * 100) : 0,
  }
}

// ---------------------------------------------------------------------------
// Compliance report generation
// ---------------------------------------------------------------------------

/**
 * Generates a full compliance report from scan results and all available rules.
 */
export function generateComplianceReport(
  results: ScanResults,
  allRules: ScanRule[],
): ComplianceReport {
  const owaspCoverage = calculateCoverage('owasp-top-10-2025', results.issues, allRules)
  const cweCoverage = calculateCoverage('cwe-top-25-2024', results.issues, allRules)

  const owaspCategories: Record<string, ComplianceCategory> = {}
  for (const coverageItem of owaspCoverage.items) {
    const status = determineStatus(coverageItem)
    owaspCategories[coverageItem.item.id] = {
      name: coverageItem.item.name,
      description: coverageItem.item.description,
      covered: coverageItem.isCovered,
      ruleCount: coverageItem.matchingRuleIds.length,
      findingCount: coverageItem.issueCount,
      ruleIds: coverageItem.matchingRuleIds,
      status,
    }
  }

  const cweCategories: Record<string, ComplianceCategory> = {}
  for (const coverageItem of cweCoverage.items) {
    const status = determineStatus(coverageItem)
    cweCategories[coverageItem.item.id] = {
      name: coverageItem.item.name,
      description: coverageItem.item.description,
      covered: coverageItem.isCovered,
      ruleCount: coverageItem.matchingRuleIds.length,
      findingCount: coverageItem.issueCount,
      ruleIds: coverageItem.matchingRuleIds,
      status,
    }
  }

  return {
    owaspCoverage: owaspCategories,
    cweCoverage: cweCategories,
    overallOwaspPercent: owaspCoverage.coveragePercent,
    overallCwePercent: cweCoverage.coveragePercent,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Determine the compliance status for a coverage item:
 * - 'pass'        : covered and no issues found
 * - 'fail'        : covered and issues were found
 * - 'warn'        : covered but only by low-confidence rules
 * - 'no-coverage' : no scanner rules cover this category
 */
function determineStatus(coverageItem: ComplianceCoverageItem): ComplianceCategory['status'] {
  if (!coverageItem.isCovered) return 'no-coverage'
  if (coverageItem.issueCount > 0) return 'fail'
  if (coverageItem.matchingRuleIds.length <= 1) return 'warn'
  return 'pass'
}

// ---------------------------------------------------------------------------
// JSON export
// ---------------------------------------------------------------------------

/**
 * Serializes a ComplianceReport as a formatted JSON string for download.
 */
export function exportComplianceJSON(report: ComplianceReport): string {
  return JSON.stringify(report, null, 2)
}
