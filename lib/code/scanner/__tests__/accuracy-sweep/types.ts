// Fixture annotation types for scanner accuracy sweep

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
  /** Whether this finding is a true positive or false positive */
  verdict: 'tp' | 'fp'
}

export interface FixtureCase {
  name: string
  description: string
  file: FixtureFile
  expected: ExpectedFinding[]
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
