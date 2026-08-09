import type { CodeIssue, IssueConfidence } from '../../types'
import type { ExpectedFinding, FixtureCase } from './types'

export interface MetadataMismatch {
  expected: ExpectedFinding
  actual: CodeIssue
  field: 'severity' | 'cwe' | 'confidence'
}

export interface FixtureEvaluation {
  matchedPresent: { expected: ExpectedFinding; actual: CodeIssue }[]
  missedPresent: ExpectedFinding[]
  violatedAbsent: { expected: ExpectedFinding; actual: CodeIssue }[]
  falsePositives: CodeIssue[]
  unreviewed: CodeIssue[]
  metadataMismatches: MetadataMismatch[]
}

const CONFIDENCE_RANK: Record<IssueConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

export function evaluateFixture(fixture: FixtureCase, actual: CodeIssue[]): FixtureEvaluation {
  const matchedPresent: FixtureEvaluation['matchedPresent'] = []
  const missedPresent: ExpectedFinding[] = []
  const violatedAbsent: FixtureEvaluation['violatedAbsent'] = []
  const metadataMismatches: MetadataMismatch[] = []
  const claimedActual = new Set<CodeIssue>()

  for (const expected of fixture.expected) {
    const finding = actual.find(
      candidate => candidate.ruleId === expected.ruleId && candidate.line === expected.line,
    )
    if (expected.expectation === 'absent') {
      if (finding) {
        claimedActual.add(finding)
        violatedAbsent.push({ expected, actual: finding })
      }
      continue
    }

    if (!finding) {
      missedPresent.push(expected)
      continue
    }

    claimedActual.add(finding)
    matchedPresent.push({ expected, actual: finding })
    if (expected.severity && finding.severity !== expected.severity) {
      metadataMismatches.push({ expected, actual: finding, field: 'severity' })
    }
    if (expected.cwe && finding.cwe !== expected.cwe) {
      metadataMismatches.push({ expected, actual: finding, field: 'cwe' })
    }
    if (
      expected.minConfidence
      && CONFIDENCE_RANK[finding.confidence ?? 'low'] < CONFIDENCE_RANK[expected.minConfidence]
    ) {
      metadataMismatches.push({ expected, actual: finding, field: 'confidence' })
    }
  }

  const unmatched = actual.filter(finding => !claimedActual.has(finding))
  return {
    matchedPresent,
    missedPresent,
    violatedAbsent,
    falsePositives: fixture.annotationScope === 'exhaustive' ? unmatched : [],
    unreviewed: fixture.annotationScope === 'exhaustive' ? [] : unmatched,
    metadataMismatches,
  }
}
