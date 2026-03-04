import type { IssueSeverity, IssueCategory, CodeIssue } from '@/lib/code/issue-scanner'

export type ViewMode = 'issues' | 'compliance'
export type CategoryFilterKey = IssueCategory | 'supply-chain' | 'structural'
export type FilterMode = 'all' | IssueSeverity | CategoryFilterKey

export interface FilteredSummary {
  total: number
  critical: number
  warning: number
  info: number
  bySecurity: number
  byBadPractice: number
  byReliability: number
  bySupplyChain: number
  byStructural: number
}

const STRUCTURAL_RULE_IDS = new Set([
  'circular-dep',
  'large-file',
  'high-coupling',
  'dead-module',
  'deep-chain',
])

export function isSupplyChainIssue(issue: CodeIssue): boolean {
  return issue.ruleId.startsWith('supply-chain-') || issue.ruleId.startsWith('gha-')
}

export function isStructuralIssue(issue: CodeIssue): boolean {
  return STRUCTURAL_RULE_IDS.has(issue.ruleId)
}

export const CATEGORY_COUNT_KEY: Record<CategoryFilterKey, keyof FilteredSummary> = {
  'security': 'bySecurity',
  'bad-practice': 'byBadPractice',
  'reliability': 'byReliability',
  'supply-chain': 'bySupplyChain',
  'structural': 'byStructural',
}
