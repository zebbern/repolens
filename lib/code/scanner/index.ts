// Barrel export — public API for the scanner module

export type {
  IssueSeverity,
  IssueCategory,
  CodeIssue,
  ScanRule,
  HealthGrade,
  ScanResults,
  CompositeRule,
} from './types'

export { scanIssues } from './scanner'

export {
  calculateCoverage,
  getComplianceItems,
  getAllStandards,
  generateComplianceReport,
  exportComplianceJSON,
  OWASP_TOP_10_2025,
  CWE_TOP_25_2024,
} from './compliance-matrix'

export type {
  ComplianceStandard,
  ComplianceItem,
  ComplianceCoverage,
  ComplianceCoverageItem,
  ComplianceCategory,
  ComplianceReport,
} from './compliance-matrix'

export {
  parseFileAST,
  getAST,
  analyzeAST,
  clearASTCache,
  isASTEligible,
  extractScopeInfo,
  findFunctionBodies,
  isRouteHandler,
  isExportedFunction,
} from './ast-analyzer'

export type { ScopeInfo, FunctionBody } from './ast-analyzer'
export { scoreIssue, scoreProject, getRiskBand, getRiskDistribution, buildCvssVector } from './risk-scorer'

export { lookupCves, lookupCvesForPackage, parseDependencies, clearCveCache, queryOSV, mapSeverity } from './cve-lookup'
export type { CveResult, CveLookupResult, PackageDependency } from './cve-lookup'
