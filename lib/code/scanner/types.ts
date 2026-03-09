// Scanner types — type definitions for the issue scanner module

export type IssueSeverity = 'critical' | 'warning' | 'info'
export type IssueCategory = 'security' | 'bad-practice' | 'reliability'

export interface CodeIssue {
  id: string
  ruleId: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  description: string
  file: string
  line: number
  column: number
  snippet: string
  suggestion?: string
  /** CWE identifier if applicable, e.g. "CWE-79" */
  cwe?: string
  /** OWASP category if applicable, e.g. "A03:2021 Injection" */
  owasp?: string
  /** Link to further reading */
  learnMoreUrl?: string
  /** Confidence level of this detection */
  confidence?: 'high' | 'medium' | 'low'
  /** Auto-fix code suggestion */
  fix?: string
  /** Description of the fix approach */
  fixDescription?: string
  /** CVSS-like risk score (0.0–10.0, one decimal) */
  riskScore?: number
  /** Human-readable scoring breakdown, e.g. "S:critical/C:high/CAT:security/CWE:79" */
  cvssVector?: string
  /** Taint flow data for data-flow tracked issues */
  taintFlow?: {
    source: string
    sink: string
    path: string[]
    startLine: number
    endLine: number
  }
}

export interface ScanRule {
  id: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  description: string
  suggestion?: string
  cwe?: string
  owasp?: string
  learnMoreUrl?: string
  // Regex-based rules use searchIndex
  pattern?: string
  patternOptions?: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }
  // Only apply to files matching these extensions
  fileFilter?: string[]
  // Exclude matches where the line content matches this
  excludePattern?: RegExp
  // Exclude files whose path matches this
  excludeFiles?: RegExp
  // Structural rules use a custom scan function
  structural?: boolean
  /** Confidence level of this rule */
  confidence?: 'high' | 'medium' | 'low'
  /** Auto-fix code suggestion */
  fix?: string
  /** Description of the fix approach */
  fixDescription?: string
  /** When false, the rule can run on metadata-only files (no content required). Defaults to true. */
  requiresContent?: boolean
}

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface ScanResults {
  issues: CodeIssue[]
  summary: {
    total: number
    critical: number
    warning: number
    info: number
    bySecurity: number
    byBadPractice: number
    byReliability: number
  }
  healthGrade: HealthGrade
  healthScore: number
  ruleOverflow: Map<string, number>
  /** Which languages were detected and scanned */
  languagesDetected: string[]
  /** How many rules were evaluated */
  rulesEvaluated: number
  scannedFiles: number
  scannedAt: Date
  /** Grade based only on security issues */
  securityGrade: HealthGrade
  /** Grade based only on quality/reliability issues */
  qualityGrade: HealthGrade
  /** Total issues per 1000 lines of code */
  issuesPerKloc: number
  /** True when only a subset of files were scanned (differential scan) */
  isPartialScan: boolean
  /** Number of files with content not yet loaded (content === ''). */
  unscannedFileCount?: number
  /** True when only metadata-only rules were evaluated (no content parsing). */
  isMetadataOnly?: boolean
  /** Number of issues suppressed by inline comments */
  suppressionCount: number
  /** CVSS-like project risk score (0.0–10.0), weighted average of issue scores */
  projectRiskScore?: number
  /** Count of issues per risk band */
  riskDistribution?: { critical: number; high: number; medium: number; low: number }
  /** Compliance coverage summary for each standard */
  complianceSummary?: { standard: string; coveredCount: number; totalCount: number; coveragePercent: number }[]
}

export interface CompositeRule {
  id: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  description: string
  suggestion: string
  cwe?: string
  owasp?: string
  learnMoreUrl?: string
  /** File extensions to scan */
  fileFilter: string[]
  /** Skip files matching this pattern (applied to file path) */
  excludeFiles?: RegExp
  /** ALL of these patterns must be present in the same file to trigger */
  requiredPatterns: RegExp[]
  /** Report on the line matching this pattern (the "sink") */
  sinkPattern: RegExp
  /** Skip if ANY of these patterns are present (mitigations) */
  mitigations?: RegExp[]
  /** Confidence level of this rule */
  confidence?: 'high' | 'medium' | 'low'
  /** Auto-fix code suggestion */
  fix?: string
  /** Description of the fix approach */
  fixDescription?: string
  /** When false, the rule can run on metadata-only files. Defaults to true. */
  requiresContent?: boolean
  /** If ANY of these patterns match, suppress the rule entirely (hard suppression) */
  mustNotContain?: RegExp[]
  /** When true, requiredPatterns[0] must appear on an earlier line than requiredPatterns[1] */
  sourceBeforeSink?: boolean
  /** Max line distance between pattern matches; if exceeded, the rule does not fire */
  maxLineDistance?: number
}
