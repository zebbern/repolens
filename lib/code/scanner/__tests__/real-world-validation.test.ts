import { describe, it, expect, beforeEach } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { scanIssues, clearScanCache } from '@/lib/code/scanner'
import { REALWORLD_CORPUS, type CorpusEntry } from './accuracy-sweep/corpus-realworld'
import type { ExpectedFinding } from './accuracy-sweep/types'
import type { CodeIssue } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tolerance window for line matching (±3 lines). */
const LINE_TOLERANCE = 3

/** Check if a finding's ruleId matches an expected ruleId (substring match). */
function ruleMatches(actualRuleId: string, expectedRuleId: string): boolean {
  const a = actualRuleId.toLowerCase()
  const e = expectedRuleId.toLowerCase()
  return a === e || a.includes(e) || e.includes(a)
}

/** Check if a finding matches an expected vulnerability. */
function findingMatchesExpected(
  finding: CodeIssue,
  expected: ExpectedFinding,
): boolean {
  if (!ruleMatches(finding.ruleId, expected.ruleId)) return false
  return Math.abs(finding.line - expected.line) <= LINE_TOLERANCE
}

interface FileResult {
  entry: CorpusEntry
  findings: CodeIssue[]
  truePositives: number
  falsePositives: number
  missedExpected: number
  usefulWarnings: number
  matchedExpected: Set<number>
}

function classifyFindings(entry: CorpusEntry, findings: CodeIssue[]): FileResult {
  const expectedTPs = entry.expected.filter(e => e.verdict === 'tp')
  const matchedExpected = new Set<number>()
  let truePositives = 0
  let usefulWarnings = 0

  const classifiedActual = new Map<string, 'tp' | 'useful'>()

  for (const finding of findings) {
    let matched = false
    for (let i = 0; i < expectedTPs.length; i++) {
      if (matchedExpected.has(i)) continue
      if (findingMatchesExpected(finding, expectedTPs[i])) {
        matchedExpected.add(i)
        truePositives++
        classifiedActual.set(finding.id, 'tp')
        matched = true
        break
      }
    }
    if (!matched) {
      // Not in ground truth — classify as useful warning (non-informational)
      // or noise (info-level on clean files)
      if (!entry.groundTruth.expectedClean && finding.severity !== 'info') {
        usefulWarnings++
        classifiedActual.set(finding.id, 'useful')
      }
    }
  }

  const falsePositives = entry.groundTruth.expectedClean
    ? findings.length
    : findings.length - truePositives - usefulWarnings

  const missedExpected = expectedTPs.length - matchedExpected.size

  return {
    entry,
    findings,
    truePositives,
    falsePositives: Math.max(0, falsePositives),
    missedExpected,
    usefulWarnings,
    matchedExpected,
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Real-world corpus validation', () => {
  const results: FileResult[] = []

  beforeEach(() => {
    clearScanCache()
  })

  it(`should scan all ${REALWORLD_CORPUS.length} corpus files and classify findings`, () => {
    for (const entry of REALWORLD_CORPUS) {
      let index = createEmptyIndex()
      index = indexFile(index, entry.file.path, entry.file.content, entry.file.language)

      const scanResult = scanIssues(index, null)
      const classified = classifyFindings(entry, scanResult.issues)
      results.push(classified)
    }

    expect(results).toHaveLength(REALWORLD_CORPUS.length)

    // -----------------------------------------------------------------------
    // Print per-file summary table
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(110))
    console.log('REAL-WORLD CORPUS SCAN RESULTS')
    console.log('='.repeat(110))
    console.log(
      'ID'.padEnd(35),
      'Cat'.padEnd(12),
      'Findings'.padStart(8),
      'TP'.padStart(5),
      'FP'.padStart(5),
      'Missed'.padStart(7),
      'Useful'.padStart(7),
      'Expected'.padStart(9),
    )
    console.log('-'.repeat(110))

    for (const r of results) {
      const expectedTPs = r.entry.expected.filter(e => e.verdict === 'tp').length
      console.log(
        r.entry.id.padEnd(35),
        r.entry.category.padEnd(12),
        String(r.findings.length).padStart(8),
        String(r.truePositives).padStart(5),
        String(r.falsePositives).padStart(5),
        String(r.missedExpected).padStart(7),
        String(r.usefulWarnings).padStart(7),
        String(expectedTPs).padStart(9),
      )
    }
    console.log('-'.repeat(110))

    // -----------------------------------------------------------------------
    // Per-category metrics
    // -----------------------------------------------------------------------
    const categories = ['vulnerable', 'secure', 'mixed'] as const
    console.log('\nPER-CATEGORY METRICS:')
    for (const cat of categories) {
      const catResults = results.filter(r => r.entry.category === cat)
      if (catResults.length === 0) continue

      const totalTP = catResults.reduce((s, r) => s + r.truePositives, 0)
      const totalFP = catResults.reduce((s, r) => s + r.falsePositives, 0)
      const totalFindings = catResults.reduce((s, r) => s + r.findings.length, 0)
      const totalExpected = catResults.reduce(
        (s, r) => s + r.entry.expected.filter(e => e.verdict === 'tp').length,
        0,
      )
      const recall = totalExpected > 0 ? (totalTP / totalExpected) * 100 : 100
      const precision = totalFindings > 0 ? (totalTP / totalFindings) * 100 : 100

      console.log(
        `  ${cat.padEnd(12)} Files=${catResults.length}  Findings=${totalFindings}  TP=${totalTP}  FP=${totalFP}  ` +
        `Recall=${recall.toFixed(1)}%  Precision=${precision.toFixed(1)}%  Expected=${totalExpected}`,
      )
    }

    // -----------------------------------------------------------------------
    // Per-rule metrics
    // -----------------------------------------------------------------------
    const ruleFires = new Map<string, { total: number; tp: number }>()
    for (const r of results) {
      const expectedTPs = r.entry.expected.filter(e => e.verdict === 'tp')
      for (const finding of r.findings) {
        const entry = ruleFires.get(finding.ruleId) ?? { total: 0, tp: 0 }
        entry.total++
        const isTP = expectedTPs.some(e => findingMatchesExpected(finding, e))
        if (isTP) entry.tp++
        ruleFires.set(finding.ruleId, entry)
      }
    }

    console.log('\nPER-RULE FIRE RATES (top 20):')
    const sortedRules = [...ruleFires.entries()]
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 20)

    for (const [ruleId, stats] of sortedRules) {
      const tpRate = stats.total > 0 ? ((stats.tp / stats.total) * 100).toFixed(0) : 'N/A'
      console.log(`  ${ruleId.padEnd(40)} fires=${String(stats.total).padStart(3)}  TP=${String(stats.tp).padStart(3)}  TP%=${tpRate}%`)
    }

    // -----------------------------------------------------------------------
    // Overall signal-to-noise
    // -----------------------------------------------------------------------
    const totalFindings = results.reduce((s, r) => s + r.findings.length, 0)
    const totalTP = results.reduce((s, r) => s + r.truePositives, 0)
    const totalUseful = results.reduce((s, r) => s + r.usefulWarnings, 0)
    const totalFP = results.reduce((s, r) => s + r.falsePositives, 0)
    const totalMissed = results.reduce((s, r) => s + r.missedExpected, 0)
    const signalToNoise = totalFindings > 0
      ? ((totalTP + totalUseful) / totalFindings) * 100
      : 100

    console.log('\nOVERALL SUMMARY:')
    console.log(`  Total findings: ${totalFindings}`)
    console.log(`  True positives: ${totalTP}`)
    console.log(`  Useful warnings: ${totalUseful}`)
    console.log(`  False positives: ${totalFP}`)
    console.log(`  Missed expected: ${totalMissed}`)
    console.log(`  Signal-to-noise: ${signalToNoise.toFixed(1)}%`)
    console.log('='.repeat(110) + '\n')
  })

  it('vulnerable files should have recall >= 50%', () => {
    // Re-scan if results not populated (test isolation)
    const vulnResults = getOrScan('vulnerable')

    const totalExpected = vulnResults.reduce(
      (s, r) => s + r.entry.expected.filter(e => e.verdict === 'tp').length,
      0,
    )
    const totalTP = vulnResults.reduce((s, r) => s + r.truePositives, 0)
    const recall = totalExpected > 0 ? (totalTP / totalExpected) * 100 : 100

    console.log(`\nVulnerable recall: ${totalTP}/${totalExpected} = ${recall.toFixed(1)}%`)
    expect(recall).toBeGreaterThanOrEqual(50)
  })

  it('secure files should have <= 3 findings per file on average', () => {
    const secureResults = getOrScan('secure')

    if (secureResults.length === 0) return

    const totalFindings = secureResults.reduce((s, r) => s + r.findings.length, 0)
    const avgFindings = totalFindings / secureResults.length

    console.log(`\nSecure files: ${totalFindings} findings across ${secureResults.length} files (avg ${avgFindings.toFixed(1)})`)
    for (const r of secureResults) {
      console.log(`  ${r.entry.id}: ${r.findings.length} findings`)
      for (const f of r.findings) {
        console.log(`    - ${f.ruleId} L${f.line}: ${f.title}`)
      }
    }

    expect(avgFindings).toBeLessThanOrEqual(3)
  })

  it('overall signal-to-noise should be > 60%', () => {
    const allResults = getOrScanAll()

    const totalFindings = allResults.reduce((s, r) => s + r.findings.length, 0)
    const totalTP = allResults.reduce((s, r) => s + r.truePositives, 0)
    const totalUseful = allResults.reduce((s, r) => s + r.usefulWarnings, 0)
    const signalToNoise = totalFindings > 0
      ? ((totalTP + totalUseful) / totalFindings) * 100
      : 100

    console.log(`\nSignal-to-noise: (${totalTP} TP + ${totalUseful} useful) / ${totalFindings} total = ${signalToNoise.toFixed(1)}%`)
    expect(signalToNoise).toBeGreaterThan(60)
  })

  // -------------------------------------------------------------------------
  // Helpers — scan on demand for isolated tests
  // -------------------------------------------------------------------------

  function scanEntry(entry: CorpusEntry): FileResult {
    clearScanCache()
    let index = createEmptyIndex()
    index = indexFile(index, entry.file.path, entry.file.content, entry.file.language)
    const scanResult = scanIssues(index, null)
    return classifyFindings(entry, scanResult.issues)
  }

  function getOrScan(category: CorpusEntry['category']): FileResult[] {
    const cached = results.filter(r => r.entry.category === category)
    if (cached.length > 0) return cached
    return REALWORLD_CORPUS
      .filter(e => e.category === category)
      .map(scanEntry)
  }

  function getOrScanAll(): FileResult[] {
    if (results.length > 0) return results
    return REALWORLD_CORPUS.map(scanEntry)
  }
})
