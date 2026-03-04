import { describe, it, expect } from 'vitest'
import {
  OWASP_TOP_10_2025,
  CWE_TOP_25_2024,
  calculateCoverage,
  getComplianceItems,
  getAllStandards,
  generateComplianceReport,
  exportComplianceJSON,
} from './compliance-matrix'
import type { CodeIssue, ScanRule, ScanResults } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<ScanRule> & { id: string }): ScanRule {
  return {
    category: 'security',
    severity: 'warning',
    title: 'Test rule',
    description: 'Test',
    ...overrides,
  }
}

function makeIssue(overrides: Partial<CodeIssue> & { id: string; ruleId: string }): CodeIssue {
  return {
    category: 'security',
    severity: 'warning',
    title: 'Test issue',
    description: 'Test',
    file: 'test.ts',
    line: 1,
    column: 0,
    snippet: '',
    ...overrides,
  }
}

function makeScanResults(issues: CodeIssue[]): ScanResults {
  return {
    issues,
    summary: {
      total: issues.length,
      critical: 0,
      warning: issues.length,
      info: 0,
      bySecurity: issues.length,
      byBadPractice: 0,
      byReliability: 0,
    },
    healthGrade: 'A',
    healthScore: 100,
    ruleOverflow: new Map(),
    languagesDetected: ['typescript'],
    rulesEvaluated: 10,
    scannedFiles: 1,
    scannedAt: new Date(),
    securityGrade: 'A',
    qualityGrade: 'A',
    issuesPerKloc: 0,
    isPartialScan: false,
    suppressionCount: 0,
  }
}

// ---------------------------------------------------------------------------
// Static data tests
// ---------------------------------------------------------------------------

describe('OWASP_TOP_10_2025', () => {
  it('has exactly 10 items', () => {
    expect(OWASP_TOP_10_2025).toHaveLength(10)
  })

  it('all items have id, name, and non-empty cwes', () => {
    for (const item of OWASP_TOP_10_2025) {
      expect(item.id).toBeTruthy()
      expect(item.name).toBeTruthy()
      expect(item.description).toBeTruthy()
      expect(item.cwes.length).toBeGreaterThan(0)
      expect(item.severity).toBeTruthy()
    }
  })

  it('uses A01–A10 IDs in order', () => {
    const ids = OWASP_TOP_10_2025.map(i => i.id)
    expect(ids).toEqual(['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'])
  })

  it('has unique IDs', () => {
    const ids = OWASP_TOP_10_2025.map(i => i.id)
    expect(new Set(ids).size).toBe(10)
  })
})

describe('CWE_TOP_25_2024', () => {
  it('has exactly 25 items', () => {
    expect(CWE_TOP_25_2024).toHaveLength(25)
  })

  it('all items have id, name, and cwes containing self', () => {
    for (const item of CWE_TOP_25_2024) {
      expect(item.id).toMatch(/^CWE-\d+$/)
      expect(item.name).toBeTruthy()
      expect(item.cwes).toContain(item.id)
    }
  })

  it('has unique IDs', () => {
    const ids = CWE_TOP_25_2024.map(i => i.id)
    expect(new Set(ids).size).toBe(25)
  })

  it('includes key CWEs from the 2024 list', () => {
    const ids = CWE_TOP_25_2024.map(i => i.id)
    expect(ids).toContain('CWE-79')
    expect(ids).toContain('CWE-89')
    expect(ids).toContain('CWE-78')
    expect(ids).toContain('CWE-918')
    expect(ids).toContain('CWE-798')
    expect(ids).toContain('CWE-502')
  })
})

// ---------------------------------------------------------------------------
// getComplianceItems
// ---------------------------------------------------------------------------

describe('getComplianceItems', () => {
  it('returns OWASP items for owasp-top-10-2025', () => {
    const items = getComplianceItems('owasp-top-10-2025')
    expect(items).toHaveLength(10)
    expect(items[0].id).toBe('A01')
  })

  it('returns CWE items for cwe-top-25-2024', () => {
    const items = getComplianceItems('cwe-top-25-2024')
    expect(items).toHaveLength(25)
    expect(items[0].id).toBe('CWE-79')
  })
})

// ---------------------------------------------------------------------------
// getAllStandards
// ---------------------------------------------------------------------------

describe('getAllStandards', () => {
  it('returns both standards', () => {
    const standards = getAllStandards()
    expect(standards).toContain('owasp-top-10-2025')
    expect(standards).toContain('cwe-top-25-2024')
    expect(standards).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// calculateCoverage
// ---------------------------------------------------------------------------

describe('calculateCoverage', () => {
  it('returns 0% coverage with no matching issues and no matching rules', () => {
    const coverage = calculateCoverage('owasp-top-10-2025', [], [])
    expect(coverage.coveragePercent).toBe(0)
    expect(coverage.coveredCount).toBe(0)
    expect(coverage.totalCount).toBe(10)
    expect(coverage.items).toHaveLength(10)
    expect(coverage.items.every(i => !i.isCovered)).toBe(true)
  })

  it('calculates 30% OWASP coverage when 3 of 10 items have matching rules', () => {
    // A01 needs CWE-22, A03 needs CWE-79, A07 needs CWE-798
    const rules: ScanRule[] = [
      makeRule({ id: 'r1', cwe: 'CWE-22' }),
      makeRule({ id: 'r2', cwe: 'CWE-79' }),
      makeRule({ id: 'r3', cwe: 'CWE-798' }),
    ]
    const issues: CodeIssue[] = [
      makeIssue({ id: 'i1', ruleId: 'r1', cwe: 'CWE-22' }),
    ]

    const coverage = calculateCoverage('owasp-top-10-2025', issues, rules)
    expect(coverage.coveragePercent).toBe(30)
    expect(coverage.coveredCount).toBe(3)
  })

  it('correctly matches CWE values between issues and compliance items', () => {
    const rules: ScanRule[] = [
      makeRule({ id: 'xss-rule', cwe: 'CWE-79' }),
    ]
    const issues: CodeIssue[] = [
      makeIssue({ id: 'i1', ruleId: 'xss-rule', cwe: 'CWE-79' }),
      makeIssue({ id: 'i2', ruleId: 'xss-rule', cwe: 'CWE-79' }),
    ]

    const coverage = calculateCoverage('cwe-top-25-2024', issues, rules)
    const xssItem = coverage.items.find(i => i.item.id === 'CWE-79')
    expect(xssItem).toBeDefined()
    expect(xssItem!.isCovered).toBe(true)
    expect(xssItem!.matchingRuleIds).toContain('xss-rule')
    expect(xssItem!.issueCount).toBe(2)
  })

  it('does not double-count the same rule for a compliance item', () => {
    const rules: ScanRule[] = [
      makeRule({ id: 'sqli-1', cwe: 'CWE-89' }),
      makeRule({ id: 'sqli-1', cwe: 'CWE-89' }), // duplicate
    ]

    const coverage = calculateCoverage('cwe-top-25-2024', [], rules)
    const sqliItem = coverage.items.find(i => i.item.id === 'CWE-89')
    expect(sqliItem!.matchingRuleIds).toEqual(['sqli-1'])
  })

  it('calculates CWE Top 25 coverage', () => {
    // Cover 5 of the 25 CWEs
    const rules: ScanRule[] = [
      makeRule({ id: 'r1', cwe: 'CWE-79' }),
      makeRule({ id: 'r2', cwe: 'CWE-89' }),
      makeRule({ id: 'r3', cwe: 'CWE-78' }),
      makeRule({ id: 'r4', cwe: 'CWE-502' }),
      makeRule({ id: 'r5', cwe: 'CWE-918' }),
    ]

    const coverage = calculateCoverage('cwe-top-25-2024', [], rules)
    expect(coverage.coveragePercent).toBe(20)
    expect(coverage.coveredCount).toBe(5)
    expect(coverage.totalCount).toBe(25)
  })

  it('returns items with zero issue count when only rules match', () => {
    const rules: ScanRule[] = [makeRule({ id: 'r1', cwe: 'CWE-79' })]

    const coverage = calculateCoverage('cwe-top-25-2024', [], rules)
    const xssItem = coverage.items.find(i => i.item.id === 'CWE-79')
    expect(xssItem!.isCovered).toBe(true)
    expect(xssItem!.issueCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// generateComplianceReport
// ---------------------------------------------------------------------------

describe('generateComplianceReport', () => {
  it('produces a report with OWASP and CWE coverage', () => {
    const rules: ScanRule[] = [
      makeRule({ id: 'r1', cwe: 'CWE-79' }),
      makeRule({ id: 'r2', cwe: 'CWE-89' }),
    ]
    const issues: CodeIssue[] = [
      makeIssue({ id: 'i1', ruleId: 'r1', cwe: 'CWE-79' }),
    ]
    const results = makeScanResults(issues)

    const report = generateComplianceReport(results, rules)

    expect(report.generatedAt).toBeTruthy()
    expect(report.overallOwaspPercent).toBeGreaterThan(0)
    expect(report.overallCwePercent).toBeGreaterThan(0)
    expect(Object.keys(report.owaspCoverage)).toHaveLength(10)
    expect(Object.keys(report.cweCoverage)).toHaveLength(25)
  })

  it('marks items with findings as "fail" status', () => {
    const rules: ScanRule[] = [makeRule({ id: 'r1', cwe: 'CWE-79' })]
    const issues: CodeIssue[] = [
      makeIssue({ id: 'i1', ruleId: 'r1', cwe: 'CWE-79' }),
    ]
    const results = makeScanResults(issues)

    const report = generateComplianceReport(results, rules)
    // A03 (Injection) includes CWE-79
    expect(report.owaspCoverage['A03'].status).toBe('fail')
  })

  it('marks uncovered items as "no-coverage"', () => {
    const results = makeScanResults([])
    const report = generateComplianceReport(results, [])

    for (const category of Object.values(report.owaspCoverage)) {
      expect(category.status).toBe('no-coverage')
    }
  })
})

// ---------------------------------------------------------------------------
// exportComplianceJSON
// ---------------------------------------------------------------------------

describe('exportComplianceJSON', () => {
  it('produces valid JSON', () => {
    const rules: ScanRule[] = [makeRule({ id: 'r1', cwe: 'CWE-79' })]
    const results = makeScanResults([])
    const report = generateComplianceReport(results, rules)
    const json = exportComplianceJSON(report)

    const parsed = JSON.parse(json)
    expect(parsed.owaspCoverage).toBeDefined()
    expect(parsed.cweCoverage).toBeDefined()
    expect(parsed.overallOwaspPercent).toBeDefined()
    expect(parsed.generatedAt).toBeTruthy()
  })

  it('produces formatted JSON with 2-space indentation', () => {
    const results = makeScanResults([])
    const report = generateComplianceReport(results, [])
    const json = exportComplianceJSON(report)

    expect(json).toContain('\n')
    expect(json).toMatch(/^{\n {2}"/)
  })
})
