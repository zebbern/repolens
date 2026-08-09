// Fixture annotation types for scanner accuracy sweep

import type { IssueConfidence, IssueSeverity } from '../../types'

export interface FixtureFile {
  path: string
  content: string
  language: string
}

export interface ExpectedFinding {
  /** Rule ID expected to fire on this line */
  ruleId: string
  /** 1-based line number in the fixture content */
  line: number
  /** Whether this finding must be emitted or must not be emitted. */
  expectation: 'present' | 'absent'
  severity?: IssueSeverity
  cwe?: string
  minConfidence?: IssueConfidence
}

export interface FixtureCase {
  name: string
  description: string
  file: FixtureFile
  expected: ExpectedFinding[]
  /** Targeted annotations leave other findings unreviewed; exhaustive annotations classify them as false positives. */
  annotationScope?: 'targeted' | 'exhaustive'
}

export interface RuleMetrics {
  ruleId: string
  totalFires: number
  truePositives: number
  falsePositives: number
  missedExpected: number
  fpRate: number
}

export interface CategoryMetrics {
  category: string
  totalFires: number
  truePositives: number
  falsePositives: number
  fpRate: number
}

export interface SweepSummary {
  totalFixtures: number
  totalExpected: number
  totalActualFindings: number
  matchedFindings: number
  unmatchedActual: number
  missedExpected: number
  perRule: RuleMetrics[]
  perCategory: CategoryMetrics[]
}
