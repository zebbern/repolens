import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/parsers/tree-sitter', () => ({
  initTreeSitter: vi.fn().mockResolvedValue(undefined),
  getLanguageForFile: vi.fn((path: string) => {
    const extension = path.split('.').pop()?.toLowerCase()
    const languages: Record<string, string> = {
      py: 'python',
      java: 'java',
      go: 'go',
      rs: 'rust',
      c: 'c',
      h: 'c',
      cpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      hpp: 'cpp',
      cs: 'csharp',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      kts: 'kotlin',
    }
    return extension ? languages[extension] : undefined
  }),
  parseFile: vi.fn().mockResolvedValue({ delete: vi.fn() }),
  queryTree: vi.fn().mockResolvedValue([]),
}))

import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import {
  clearScanCache,
  getAllRules,
  scanIssuesAsync,
} from '@/lib/code/scanner/scanner'
import { TREE_SITTER_RULES } from '@/lib/code/scanner/rules-tree-sitter'
import type { CodeIssue } from '../../types'
import { evaluateFixture } from './accuracy-harness'
import type { ExpectedFinding, FixtureCase } from './types'
import { cFixtures } from './fixtures-c'
import { compositeFixtures } from './fixtures-composite'
import { csharpFixtures } from './fixtures-csharp'
import { goFixtures } from './fixtures-go'
import { javaFixtures } from './fixtures-java'
import { jstsFixtures } from './fixtures-jsts'
import { kotlinFixtures } from './fixtures-kotlin'
import { phpFixtures } from './fixtures-php'
import { pythonFixtures } from './fixtures-python'
import { rubyFixtures } from './fixtures-ruby'
import { rustFixtures } from './fixtures-rust'
import { shellFixtures } from './fixtures-shell'

const TARGETED_UNREVIEWED_BASELINE = 119

const ALL_FIXTURES: FixtureCase[] = [
  ...jstsFixtures,
  ...pythonFixtures,
  ...goFixtures,
  ...rustFixtures,
  ...javaFixtures,
  ...compositeFixtures,
  ...phpFixtures,
  ...cFixtures,
  ...rubyFixtures,
  ...shellFixtures,
  ...csharpFixtures,
  ...kotlinFixtures,
]

interface LocatedExpectation {
  fixture: string
  expected: ExpectedFinding
}

interface LocatedFinding {
  fixture: string
  finding: CodeIssue
}

describe('Scanner Accuracy Sweep', () => {
  beforeEach(() => clearScanCache())

  it('meets the authoritative accuracy gates', { timeout: 120_000 }, async () => {
    const securityRuleIds = new Set([
      ...getAllRules().filter(rule => rule.category === 'security').map(rule => rule.id),
      ...TREE_SITTER_RULES.filter(rule => rule.category === 'security').map(rule => rule.id),
    ])
    const missedPresent: LocatedExpectation[] = []
    const violatedAbsent: LocatedExpectation[] = []
    const metadataMismatches: string[] = []
    const unreviewed: LocatedFinding[] = []
    let matchedSecurity = 0
    let expectedSecurity = 0
    let exhaustiveHighConfidenceFindings = 0
    let exhaustiveHighConfidenceTruePositives = 0
    let exhaustiveFixtureCount = 0

    for (const fixture of ALL_FIXTURES) {
      let index = createEmptyIndex()
      index = indexFile(index, fixture.file.path, fixture.file.content, fixture.file.language)
      const result = await scanIssuesAsync(index, null, { failureMode: 'strict' })
      clearScanCache()
      const evaluation = evaluateFixture(fixture, result.issues)

      missedPresent.push(...evaluation.missedPresent.map(expected => ({ fixture: fixture.name, expected })))
      violatedAbsent.push(...evaluation.violatedAbsent.map(({ expected }) => ({ fixture: fixture.name, expected })))
      metadataMismatches.push(...evaluation.metadataMismatches.map(mismatch =>
        `${fixture.name}: ${mismatch.expected.ruleId}:${mismatch.expected.line} ${mismatch.field}`,
      ))
      unreviewed.push(...evaluation.unreviewed.map(finding => ({ fixture: fixture.name, finding })))

      for (const expected of fixture.expected) {
        if (expected.expectation !== 'present' || !securityRuleIds.has(expected.ruleId)) continue
        expectedSecurity++
        if (evaluation.matchedPresent.some(match => match.expected === expected)) matchedSecurity++
      }

      if (fixture.annotationScope === 'exhaustive') {
        exhaustiveFixtureCount++
        const matched = new Set(evaluation.matchedPresent.map(match => match.actual))
        for (const finding of result.issues) {
          if (finding.confidence !== 'high') continue
          exhaustiveHighConfidenceFindings++
          if (matched.has(finding)) exhaustiveHighConfidenceTruePositives++
        }
      }
    }

    const highConfidencePrecision = exhaustiveHighConfidenceFindings === 0
      ? 1
      : exhaustiveHighConfidenceTruePositives / exhaustiveHighConfidenceFindings
    const securityRecall = expectedSecurity === 0 ? 1 : matchedSecurity / expectedSecurity
    const formatExpectation = ({ fixture, expected }: LocatedExpectation) =>
      `${fixture}: ${expected.ruleId}:${expected.line}`

    expect(missedPresent.map(formatExpectation), 'missed present expectations').toEqual([])
    expect(violatedAbsent.map(formatExpectation), 'violated absent expectations').toEqual([])
    expect(metadataMismatches, 'finding metadata mismatches').toEqual([])
    expect(highConfidencePrecision, 'high-confidence exhaustive precision').toBeGreaterThanOrEqual(0.95)
    expect(securityRecall, 'security recall').toBeGreaterThanOrEqual(0.9)
    expect(unreviewed.length, 'targeted unreviewed baseline').toBeLessThanOrEqual(
      TARGETED_UNREVIEWED_BASELINE,
    )
    expect(ALL_FIXTURES.length).toBeGreaterThanOrEqual(220)
    expect(exhaustiveFixtureCount, 'audited exhaustive fixtures').toBeGreaterThan(0)
  })
})
