// Issue Scanner — explicit re-exports for tree-shaking.
// Heavy symbols (scanIssues, AST-analyzer, taint-tracker) are NOT re-exported;
// import them directly from './scanner/scanner', './scanner/ast-analyzer', or
// './scanner/taint-tracker' when needed.

// --- Core types ---
export type {
  IssueSeverity,
  IssueCategory,
  CodeIssue,
  ScanRule,
  HealthGrade,
  ScanResults,
  CompositeRule,
} from './scanner'

// --- Worker-based scanning (lazy, no Babel in main thread) ---
export { scanInWorker, terminateScanWorker } from './scanner'

// --- Tree-sitter scanning ---
export { scanWithTreeSitter } from './scanner'
export { TREE_SITTER_RULES, getRulesForLanguage, getLanguagesWithRules } from './scanner'
export type { TreeSitterRule } from './scanner'

// --- Rules (getAllRules transitively imports scanner.ts; consumers accept the cost) ---
export { getAllRules, clearScanCache } from './scanner'

// --- Compliance utilities ---
export {
  calculateCoverage,
  getComplianceItems,
  getAllStandards,
  generateComplianceReport,
  exportComplianceJSON,
  OWASP_TOP_10_2025,
  CWE_TOP_25_2024,
} from './scanner'

export type {
  ComplianceStandard,
  ComplianceItem,
  ComplianceCoverage,
  ComplianceCoverageItem,
  ComplianceCategory,
  ComplianceReport,
} from './scanner'

// --- Risk scoring ---
export { scoreIssue, scoreProject, getRiskBand, getRiskDistribution, buildCvssVector } from './scanner'

// --- CVE lookup ---
export { lookupCves, lookupCvesForPackage, parseDependencies, clearCveCache, queryOSV, mapSeverity } from './scanner'
export type { CveResult, CveLookupResult, PackageDependency } from './scanner'

// --- AI validation ---
export { validateFinding, validateBatch, buildValidationPrompt, parseValidationResponse, getCodeContext, clearValidationCache, getCachedResult, scrubSecrets } from './scanner'
export type { ValidationResult, ValidationOptions, BatchValidationResult, ValidationVerdict, ValidationConfidence } from './scanner'

// --- Fix generation ---
export { generateFix, generateDiff, getAllFixSuggestions } from './scanner'
export type { FixSuggestion, DiffLine } from './scanner'
