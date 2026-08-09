import { describe, expect, it } from 'vitest'

import type { CodeIssue } from '../../types'
import { evaluateFixture } from './accuracy-harness'
import type { FixtureCase } from './types'

function issue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: 'rule-file-1',
    ruleId: 'rule',
    category: 'security',
    severity: 'critical',
    title: 'Finding',
    description: 'Finding description',
    file: 'fixture.ts',
    line: 1,
    column: 0,
    snippet: 'danger()',
    confidence: 'high',
    cwe: 'CWE-79',
    ...overrides,
  }
}

function fixture(overrides: Partial<FixtureCase> = {}): FixtureCase {
  return {
    name: 'fixture',
    description: 'fixture',
    file: { path: 'fixture.ts', content: 'danger()', language: 'typescript' },
    expected: [],
    ...overrides,
  }
}

describe('accuracy harness', () => {
  it('fails a missed present expectation', () => {
    const evaluation = evaluateFixture(fixture({
      expected: [{ ruleId: 'rule', line: 1, expectation: 'present' }],
    }), [])

    expect(evaluation.missedPresent).toHaveLength(1)
  })

  it('fails a violated absent expectation', () => {
    const evaluation = evaluateFixture(fixture({
      expected: [{ ruleId: 'rule', line: 1, expectation: 'absent' }],
    }), [issue()])

    expect(evaluation.violatedAbsent).toHaveLength(1)
  })

  it('counts an unannotated exhaustive finding as a false positive', () => {
    const evaluation = evaluateFixture(fixture({ annotationScope: 'exhaustive' }), [issue()])

    expect(evaluation.falsePositives).toEqual([issue()])
    expect(evaluation.unreviewed).toHaveLength(0)
  })

  it('keeps an unannotated targeted finding unreviewed', () => {
    const evaluation = evaluateFixture(fixture(), [issue()])

    expect(evaluation.falsePositives).toHaveLength(0)
    expect(evaluation.unreviewed).toEqual([issue()])
  })

  it('fails severity, CWE, and minimum-confidence mismatches', () => {
    const evaluation = evaluateFixture(fixture({
      expected: [{
        ruleId: 'rule',
        line: 1,
        expectation: 'present',
        severity: 'warning',
        cwe: 'CWE-89',
        minConfidence: 'high',
      }],
    }), [issue({ confidence: 'medium' })])

    expect(evaluation.metadataMismatches.map(mismatch => mismatch.field)).toEqual([
      'severity',
      'cwe',
      'confidence',
    ])
  })
})
