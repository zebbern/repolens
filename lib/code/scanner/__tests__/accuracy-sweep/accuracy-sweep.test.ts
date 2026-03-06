// Scanner accuracy sweep — measures per-rule false positive rates
// by running realistic code fixtures through the full scanner pipeline.

import { describe, it, expect, beforeEach } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { scanIssues, clearScanCache } from '@/lib/code/scanner/scanner'
import type { FixtureCase, ExpectedFinding, RuleMetrics, CategoryMetrics, SweepSummary } from './types'
import type { CodeIssue } from '../../types'

// Import fixture sets
import { jstsFixtures } from './fixtures-jsts'
import { pythonFixtures } from './fixtures-python'
import { goFixtures } from './fixtures-go'
import { rustFixtures } from './fixtures-rust'
import { javaFixtures } from './fixtures-java'
import { compositeFixtures } from './fixtures-composite'
import { phpFixtures } from './fixtures-php'
import { cFixtures } from './fixtures-c'
import { rubyFixtures } from './fixtures-ruby'
import { shellFixtures } from './fixtures-shell'
import { csharpFixtures } from './fixtures-csharp'
import { kotlinFixtures } from './fixtures-kotlin'

// ---------------------------------------------------------------------------
// All fixtures combined
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Matching logic: compare actual findings against expected annotations
// ---------------------------------------------------------------------------

interface MatchResult {
  matched: { expected: ExpectedFinding; actual: CodeIssue }[]
  missedExpected: ExpectedFinding[]
  unmatchedActual: CodeIssue[]
}

function matchFindings(
  expected: ExpectedFinding[],
  actual: CodeIssue[],
): MatchResult {
  const matched: MatchResult['matched'] = []
  const remainingActual = [...actual]

  for (const exp of expected) {
    const idx = remainingActual.findIndex(
      a => a.ruleId === exp.ruleId && a.line === exp.line,
    )
    if (idx !== -1) {
      matched.push({ expected: exp, actual: remainingActual[idx] })
      remainingActual.splice(idx, 1)
    }
  }

  const missedExpected = expected.filter(
    exp => !matched.some(m => m.expected === exp),
  )

  return { matched, missedExpected, unmatchedActual: remainingActual }
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

function computeSweepSummary(
  results: { fixture: FixtureCase; match: MatchResult }[],
): SweepSummary {
  const ruleMap = new Map<string, RuleMetrics>()
  let totalExpected = 0
  let totalActual = 0
  let totalMatched = 0
  let totalUnmatched = 0
  let totalMissed = 0

  for (const { fixture, match } of results) {
    totalExpected += fixture.expected.length
    totalActual += match.matched.length + match.unmatchedActual.length
    totalMatched += match.matched.length
    totalUnmatched += match.unmatchedActual.length
    totalMissed += match.missedExpected.length

    // Count matched findings by verdict
    for (const m of match.matched) {
      const metrics = getOrCreateRuleMetrics(ruleMap, m.expected.ruleId)
      metrics.totalFires++
      if (m.expected.verdict === 'tp') metrics.truePositives++
      else metrics.falsePositives++
    }

    // Unmatched actual findings are unannotated — count as fires
    for (const a of match.unmatchedActual) {
      const metrics = getOrCreateRuleMetrics(ruleMap, a.ruleId)
      metrics.totalFires++
      // Unannotated findings are counted separately, not as TP or FP
    }

    // Missed expected findings
    for (const m of match.missedExpected) {
      const metrics = getOrCreateRuleMetrics(ruleMap, m.ruleId)
      metrics.missedExpected++
    }
  }

  // Compute FP rates
  const perRule: RuleMetrics[] = Array.from(ruleMap.values()).map(m => ({
    ...m,
    fpRate: m.truePositives + m.falsePositives > 0
      ? m.falsePositives / (m.truePositives + m.falsePositives)
      : 0,
  }))
  perRule.sort((a, b) => b.fpRate - a.fpRate || b.totalFires - a.totalFires)

  // Per-category metrics
  const catMap = new Map<string, CategoryMetrics>()
  for (const { match } of results) {
    for (const m of match.matched) {
      const cat = m.actual.category
      const cm = getOrCreateCategoryMetrics(catMap, cat)
      cm.totalFires++
      if (m.expected.verdict === 'tp') cm.truePositives++
      else cm.falsePositives++
    }
    for (const a of match.unmatchedActual) {
      const cm = getOrCreateCategoryMetrics(catMap, a.category)
      cm.totalFires++
    }
  }
  const perCategory: CategoryMetrics[] = Array.from(catMap.values()).map(c => ({
    ...c,
    fpRate: c.truePositives + c.falsePositives > 0
      ? c.falsePositives / (c.truePositives + c.falsePositives)
      : 0,
  }))

  return {
    totalFixtures: results.length,
    totalExpected,
    totalActualFindings: totalActual,
    matchedFindings: totalMatched,
    unmatchedActual: totalUnmatched,
    missedExpected: totalMissed,
    perRule,
    perCategory,
  }
}

function getOrCreateRuleMetrics(map: Map<string, RuleMetrics>, ruleId: string): RuleMetrics {
  let m = map.get(ruleId)
  if (!m) {
    m = { ruleId, totalFires: 0, truePositives: 0, falsePositives: 0, missedExpected: 0, fpRate: 0 }
    map.set(ruleId, m)
  }
  return m
}

function getOrCreateCategoryMetrics(map: Map<string, CategoryMetrics>, category: string): CategoryMetrics {
  let c = map.get(category)
  if (!c) {
    c = { category, totalFires: 0, truePositives: 0, falsePositives: 0, fpRate: 0 }
    map.set(category, c)
  }
  return c
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

describe('Scanner Accuracy Sweep', () => {
  beforeEach(() => {
    clearScanCache()
  })

  // Collect results for summary output
  const fixtureResults: { fixture: FixtureCase; match: MatchResult }[] = []

  // Run each fixture as an individual test
  for (const fixture of ALL_FIXTURES) {
    it(`[${fixture.file.language}] ${fixture.name}`, () => {
      // Build index with single fixture file
      let index = createEmptyIndex()
      index = indexFile(index, fixture.file.path, fixture.file.content, fixture.file.language)

      // Run scanner
      const result = scanIssues(index, null)
      clearScanCache()

      // Match actual findings against expected annotations
      const match = matchFindings(fixture.expected, result.issues)
      fixtureResults.push({ fixture, match })

      // Assert all expected TPs were found
      const missedTPs = match.missedExpected.filter(e => e.verdict === 'tp')
      if (missedTPs.length > 0) {
        const details = missedTPs
          .map(m => `  - ${m.ruleId} at line ${m.line}`)
          .join('\n')
        // Report but don't fail — this is a measurement harness
        console.warn(
          `[${fixture.name}] Missed expected TPs:\n${details}`,
        )
      }

      // Report unexpected findings (potential FPs not annotated)
      if (match.unmatchedActual.length > 0) {
        const details = match.unmatchedActual
          .map(a => `  - ${a.ruleId} at line ${a.line}: ${a.snippet.substring(0, 80)}`)
          .join('\n')
        console.warn(
          `[${fixture.name}] Unannotated findings (${match.unmatchedActual.length}):\n${details}`,
        )
      }

      // The test "passes" — accuracy sweep is about measurement, not pass/fail
      // But we verify the scanner ran without errors
      expect(result).toBeDefined()
      expect(result.issues).toBeInstanceOf(Array)
    })
  }

  // Summary test — runs after all fixtures
  it('produces accuracy summary', () => {
    // If no fixture tests ran yet (e.g. test isolation), run them all now
    if (fixtureResults.length === 0) {
      for (const fixture of ALL_FIXTURES) {
        let index = createEmptyIndex()
        index = indexFile(index, fixture.file.path, fixture.file.content, fixture.file.language)
        const result = scanIssues(index, null)
        clearScanCache()
        const match = matchFindings(fixture.expected, result.issues)
        fixtureResults.push({ fixture, match })
      }
    }

    const summary = computeSweepSummary(fixtureResults)

    // Output structured summary
    console.log('\n' + '='.repeat(72))
    console.log('SCANNER ACCURACY SWEEP SUMMARY')
    console.log('='.repeat(72))
    console.log(`Fixtures:           ${summary.totalFixtures}`)
    console.log(`Expected findings:  ${summary.totalExpected}`)
    console.log(`Actual findings:    ${summary.totalActualFindings}`)
    console.log(`Matched:            ${summary.matchedFindings}`)
    console.log(`Unmatched actual:   ${summary.unmatchedActual}`)
    console.log(`Missed expected:    ${summary.missedExpected}`)

    if (summary.perRule.length > 0) {
      console.log('\n--- Per-Rule Metrics (sorted by FP rate) ---')
      console.table(
        summary.perRule.map(r => ({
          Rule: r.ruleId,
          Fires: r.totalFires,
          TP: r.truePositives,
          FP: r.falsePositives,
          Missed: r.missedExpected,
          'FP Rate': `${(r.fpRate * 100).toFixed(1)}%`,
        })),
      )
    }

    if (summary.perCategory.length > 0) {
      console.log('\n--- Per-Category Metrics ---')
      console.table(
        summary.perCategory.map(c => ({
          Category: c.category,
          Fires: c.totalFires,
          TP: c.truePositives,
          FP: c.falsePositives,
          'FP Rate': `${(c.fpRate * 100).toFixed(1)}%`,
        })),
      )
    }

    // Output machine-readable JSON for downstream analysis
    console.log('\n--- Machine-Readable Summary (JSON) ---')
    console.log(JSON.stringify(summary, null, 2))
    console.log('='.repeat(72))

    // Verify minimum fixture count
    expect(summary.totalFixtures).toBeGreaterThanOrEqual(185)

    // Count total annotated expected findings (120+ required)
    const totalAnnotated = ALL_FIXTURES.reduce((sum, f) => sum + f.expected.length, 0)
    expect(totalAnnotated).toBeGreaterThanOrEqual(150)
  })
})
