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
