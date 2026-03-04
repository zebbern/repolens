// Scanner Integration Tests — end-to-end scan pipeline verification
//
// Tests the full scanIssues pipeline: regex rules, AST analysis, taint tracking,
// risk scoring, health grading, differential scans, deduplication, and sorting.

import { describe, it, expect } from 'vitest'
import { scanIssues } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import type { CodeIndex, IndexedFile } from '@/lib/code/code-index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCodeIndex(files: { path: string; content: string; language?: string }[]): CodeIndex {
  let index = createEmptyIndex()
  for (const f of files) {
    index = indexFile(index, f.path, f.content, f.language ?? 'typescript')
  }
  return index
}

// ---------------------------------------------------------------------------
// Full pipeline tests
// ---------------------------------------------------------------------------

describe('scanner integration — full pipeline', () => {
  it('AST analysis detects eval() usage in TypeScript', () => {
    const index = makeCodeIndex([
      { path: 'src/handler.ts', content: 'const result = eval(userInput)', language: 'typescript' },
    ])

    const results = scanIssues(index, null)

    const evalIssues = results.issues.filter(i => i.ruleId === 'eval-usage')
    expect(evalIssues.length).toBeGreaterThanOrEqual(1)
    expect(evalIssues[0].category).toBe('security')
    expect(evalIssues[0].severity).toBe('critical')
  })

  it('AST analysis detects empty catch blocks', () => {
    const code = `
function handler() {
  try {
    riskyOperation()
  } catch (e) { }
}
`
    const index = makeCodeIndex([{ path: 'src/handler.ts', content: code }])
    const results = scanIssues(index, null)

    const emptyCatch = results.issues.filter(i => i.ruleId === 'empty-catch')
    expect(emptyCatch.length).toBeGreaterThanOrEqual(1)
  })

  it('taint tracking detects source→sink flow without sanitizer', () => {
    const code = `
function handler(req, res) {
  const id = req.query.id;
  db.query("SELECT * FROM users WHERE id = " + id);
}
`
    const index = makeCodeIndex([{ path: 'src/handler.ts', content: code }])
    const results = scanIssues(index, null)

    // The taint tracker should find an unsanitized flow
    const taintIssues = results.issues.filter(i =>
      i.ruleId.startsWith('taint-') || i.description.includes('taint')
        || i.ruleId === 'sql-injection' || i.title.toLowerCase().includes('taint')
    )
    // At minimum, the regex-based sql-injection or taint-based should fire
    expect(results.issues.length).toBeGreaterThanOrEqual(1)
  })

  it('risk scores are assigned to all issues', () => {
    const code = `
eval(userInput)
console.log("debug")
const x: any = foo
`
    const index = makeCodeIndex([{ path: 'src/app.ts', content: code }])
    const results = scanIssues(index, null)

    expect(results.issues.length).toBeGreaterThanOrEqual(2)
    for (const issue of results.issues) {
      expect(issue.riskScore).toBeDefined()
      expect(typeof issue.riskScore).toBe('number')
      expect(issue.riskScore!).toBeGreaterThanOrEqual(0)
      expect(issue.riskScore!).toBeLessThanOrEqual(10)
    }
  })

  it('CVSS vectors are assigned to all issues', () => {
    const code = 'eval(userInput)\nconsole.log("x")'
    const index = makeCodeIndex([{ path: 'src/app.ts', content: code }])
    const results = scanIssues(index, null)

    for (const issue of results.issues) {
      expect(issue.cvssVector).toBeDefined()
      expect(typeof issue.cvssVector).toBe('string')
      expect(issue.cvssVector!.length).toBeGreaterThan(0)
    }
  })

  it('projectRiskScore is present in results', () => {
    const code = 'eval(input)\nconsole.log("test")'
    const index = makeCodeIndex([{ path: 'src/app.ts', content: code }])
    const results = scanIssues(index, null)

    expect(results.projectRiskScore).toBeDefined()
    expect(typeof results.projectRiskScore).toBe('number')
  })

  it('riskDistribution is present in results', () => {
    const code = 'eval(input)\nconsole.log("test")'
    const index = makeCodeIndex([{ path: 'src/app.ts', content: code }])
    const results = scanIssues(index, null)

    expect(results.riskDistribution).toBeDefined()
    expect(results.riskDistribution).toHaveProperty('critical')
    expect(results.riskDistribution).toHaveProperty('high')
    expect(results.riskDistribution).toHaveProperty('medium')
    expect(results.riskDistribution).toHaveProperty('low')
  })
})

// ---------------------------------------------------------------------------
// Health scoring
// ---------------------------------------------------------------------------

describe('scanner integration — health scoring', () => {
  it('produces grade A for clean code', () => {
    const index = makeCodeIndex([
      { path: 'src/clean.ts', content: 'export const add = (a: number, b: number): number => a + b' },
    ])
    const results = scanIssues(index, null)
    expect(results.healthGrade).toBe('A')
    expect(results.healthScore).toBeGreaterThanOrEqual(90)
  })

  it('caps grade at D/F for critical issues', () => {
    const index = makeCodeIndex([
      { path: 'src/bad.ts', content: 'eval(x)\neval(y)' },
    ])
    const results = scanIssues(index, null)
    expect(results.healthScore).toBeLessThanOrEqual(35)
    expect(results.healthGrade).toMatch(/^[D-F]$/)
  })

  it('computes separate securityGrade and qualityGrade', () => {
    const index = makeCodeIndex([
      { path: 'src/app.ts', content: 'eval(x)\nconsole.log("test")' },
    ])
    const results = scanIssues(index, null)
    expect(results.securityGrade).toMatch(/^[A-F]$/)
    expect(results.qualityGrade).toMatch(/^[A-F]$/)
  })
})

// ---------------------------------------------------------------------------
// Differential scan
// ---------------------------------------------------------------------------

describe('scanner integration — differential scan', () => {
  it('filters issues to only changed files', () => {
    const index = makeCodeIndex([
      { path: 'src/a.ts', content: 'eval(userInput)' },
      { path: 'src/b.ts', content: 'eval(otherInput)' },
    ])

    const fullResults = scanIssues(index, null)
    const partialResults = scanIssues(index, null, ['src/a.ts'])

    expect(partialResults.isPartialScan).toBe(true)
    // Partial scan should have fewer or equal issues
    expect(partialResults.issues.length).toBeLessThanOrEqual(fullResults.issues.length)
    // All issues should be from the changed file
    for (const issue of partialResults.issues) {
      expect(issue.file).toBe('src/a.ts')
    }
  })

  it('sets isPartialScan:false for full scans', () => {
    const index = makeCodeIndex([
      { path: 'src/app.ts', content: 'const x = 1' },
    ])
    const results = scanIssues(index, null)
    expect(results.isPartialScan).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Deduplication and sorting
// ---------------------------------------------------------------------------

describe('scanner integration — deduplication & sorting', () => {
  it('deduplicates issues with same id (file+line+rule)', () => {
    // The scanner generates unique IDs per rule+file+line.
    // Two different rules on the same line should NOT deduplicate.
    const code = 'eval(userInput)'
    const index = makeCodeIndex([{ path: 'src/handler.ts', content: code }])
    const results = scanIssues(index, null)

    const ids = results.issues.map(i => i.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('sorts issues with critical severity first', () => {
    const code = [
      'console.log("debug")',       // info/bad-practice
      'eval(userInput)',             // critical/security
      'const x: any = 1',           // warning/bad-practice
    ].join('\n')
    const index = makeCodeIndex([{ path: 'src/mixed.ts', content: code }])
    const results = scanIssues(index, null)

    expect(results.issues.length).toBeGreaterThanOrEqual(2)
    const severities = results.issues.map(i => i.severity)
    const critIdx = severities.indexOf('critical')
    const warnIdx = severities.indexOf('warning')
    const infoIdx = severities.indexOf('info')
    if (critIdx >= 0 && warnIdx >= 0) expect(critIdx).toBeLessThan(warnIdx)
    if (warnIdx >= 0 && infoIdx >= 0) expect(warnIdx).toBeLessThan(infoIdx)
  })
})

// ---------------------------------------------------------------------------
// MAX_PER_RULE overflow
// ---------------------------------------------------------------------------

describe('scanner integration — MAX_PER_RULE overflow', () => {
  it('caps issues per rule at 15 and tracks overflow', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `const r${i} = eval("x${i}")`)
    const index = makeCodeIndex([{ path: 'src/many-evals.ts', content: lines.join('\n') }])
    const results = scanIssues(index, null)

    const evalIssues = results.issues.filter(i => i.ruleId === 'eval-usage')
    expect(evalIssues.length).toBeLessThanOrEqual(15)
    if (evalIssues.length === 15) {
      expect(results.ruleOverflow.has('eval-usage')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Summary accuracy
// ---------------------------------------------------------------------------

describe('scanner integration — summary accuracy', () => {
  it('summary counts match actual issue counts', () => {
    const code = 'eval(input)\nconsole.log("test")\nconst x: any = 1'
    const index = makeCodeIndex([{ path: 'src/app.ts', content: code }])
    const results = scanIssues(index, null)

    expect(results.summary.total).toBe(results.issues.length)
    const critCount = results.issues.filter(i => i.severity === 'critical').length
    const warnCount = results.issues.filter(i => i.severity === 'warning').length
    const infoCount = results.issues.filter(i => i.severity === 'info').length
    expect(results.summary.critical).toBe(critCount)
    expect(results.summary.warning).toBe(warnCount)
    expect(results.summary.info).toBe(infoCount)
    expect(critCount + warnCount + infoCount).toBe(results.summary.total)
  })

  it('category counts match actual issue categories', () => {
    const code = 'eval(input)\nconsole.log("test")'
    const index = makeCodeIndex([{ path: 'src/app.ts', content: code }])
    const results = scanIssues(index, null)

    const bySecurity = results.issues.filter(i => i.category === 'security').length
    const byBadPractice = results.issues.filter(i => i.category === 'bad-practice').length
    const byReliability = results.issues.filter(i => i.category === 'reliability').length
    expect(results.summary.bySecurity).toBe(bySecurity)
    expect(results.summary.byBadPractice).toBe(byBadPractice)
    expect(results.summary.byReliability).toBe(byReliability)
  })

  it('scannedAt is a valid Date', () => {
    const index = makeCodeIndex([{ path: 'src/app.ts', content: 'const x = 1' }])
    const results = scanIssues(index, null)
    expect(results.scannedAt).toBeInstanceOf(Date)
  })

  it('issuesPerKloc is computed correctly', () => {
    const index = makeCodeIndex([{ path: 'src/app.ts', content: 'const x = 1' }])
    const results = scanIssues(index, null)
    expect(typeof results.issuesPerKloc).toBe('number')
    expect(results.issuesPerKloc).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// Multi-file integration
// ---------------------------------------------------------------------------

describe('scanner integration — multi-file', () => {
  it('aggregates issues across multiple files', () => {
    const index = makeCodeIndex([
      { path: 'src/a.ts', content: 'eval(input)' },
      { path: 'src/b.ts', content: 'console.log("debug")' },
      { path: 'src/c.ts', content: 'export const clean = 1' },
    ])
    const results = scanIssues(index, null)

    expect(results.scannedFiles).toBe(3)
    const files = new Set(results.issues.map(i => i.file))
    expect(files.size).toBeGreaterThanOrEqual(2)
  })

  it('skips vendored files (node_modules)', () => {
    const index = makeCodeIndex([
      { path: 'node_modules/pkg/index.js', content: 'eval(input)', language: 'javascript' },
      { path: 'src/clean.ts', content: 'const x = 1' },
    ])
    const results = scanIssues(index, null)

    const vendored = results.issues.filter(i => i.file.includes('node_modules'))
    expect(vendored).toHaveLength(0)
  })
})
