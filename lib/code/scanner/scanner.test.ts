import { vi } from 'vitest'

vi.mock('@/lib/parsers/tree-sitter', () => import('@/lib/code/scanner/__tests__/tree-sitter-mock'))

import { scan } from '@/lib/code/scanner/__tests__/scan-test-helpers'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'

describe('scanIssuesAsync', () => {
  it('returns empty results for clean code', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/clean.ts', 'const add = (a: number, b: number) => a + b', 'typescript')

    const result = await scan(index, null)
    expect(result.issues.length).toBeLessThanOrEqual(1) // may find nothing or trivial info
    expect(result.summary.total).toBe(result.issues.length)
    expect(result.scannedFiles).toBe(1)
    expect(result.scannedAt).toBeInstanceOf(Date)
  })

  it('detects security issues in code with eval', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/danger.ts', 'const result = eval(userInput)', 'typescript')

    const result = await scan(index, null)
    const evalIssues = result.issues.filter(i => i.ruleId === 'eval-usage')
    expect(evalIssues.length).toBeGreaterThanOrEqual(1)
    expect(evalIssues[0].category).toBe('security')
    expect(evalIssues[0].severity).toBe('critical')
  })

  it('detects bad practice issues', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/messy.ts', 'console.log("debug info")', 'typescript')

    const result = await scan(index, null)
    const consoleIssues = result.issues.filter(i => i.ruleId === 'console-log')
    expect(consoleIssues.length).toBeGreaterThanOrEqual(1)
    expect(consoleIssues[0].category).toBe('bad-practice')
  })

  it('computes health score', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/clean.ts', 'const x = 1', 'typescript')

    const result = await scan(index, null)
    expect(result.healthScore).toBeGreaterThanOrEqual(0)
    expect(result.healthScore).toBeLessThanOrEqual(100)
    expect(result.healthGrade).toMatch(/^[A-F]$/)
  })

  it('penalizes health score for critical issues', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/danger.ts', 'const x = eval(input)', 'typescript')

    const result = await scan(index, null)
    // Critical issues hard cap score at 35 (grade D)
    expect(result.healthScore).toBeLessThanOrEqual(35)
  })

  it('sorts issues by severity (critical first)', async () => {
    let index = createEmptyIndex()
    const code = [
      'console.log("debug")',       // info
      'eval(userInput)',             // critical
      'const x: any = 1',           // warning
    ].join('\n')
    index = indexFile(index, 'src/mixed.ts', code, 'typescript')

    const result = await scan(index, null)
    expect(result.issues.length).toBeGreaterThanOrEqual(2)
    const severities = result.issues.map(i => i.severity)
    const critIdx = severities.indexOf('critical')
    const warnIdx = severities.indexOf('warning')
    const infoIdx = severities.indexOf('info')
    if (critIdx >= 0 && warnIdx >= 0) expect(critIdx).toBeLessThan(warnIdx)
    if (warnIdx >= 0 && infoIdx >= 0) expect(warnIdx).toBeLessThan(infoIdx)
  })

  it('reports correct summary counts', async () => {
    let index = createEmptyIndex()
    const code = [
      'eval(input)',            // critical security
      'console.log("test")',   // info bad-practice
    ].join('\n')
    index = indexFile(index, 'src/test.ts', code, 'typescript')

    const result = await scan(index, null)
    expect(result.summary.total).toBe(result.issues.length)
    expect(result.summary.critical + result.summary.warning + result.summary.info).toBe(result.summary.total)
  })

  it('detects languages present in the index', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const x = 1', 'typescript')
    index = indexFile(index, 'src/main.py', 'x = 1', 'python')

    const result = await scan(index, null)
    expect(result.languagesDetected).toContain('JavaScript/TypeScript')
    expect(result.languagesDetected).toContain('Python')
  })

  it('caps per-rule issues at 15 and tracks overflow', async () => {
    let index = createEmptyIndex()
    // Create many non-security matches to exceed MAX_PER_RULE
    const lines = Array.from({ length: 20 }, (_, i) => `console.log("x${i}")`)
    index = indexFile(index, 'src/many-logs.ts', lines.join('\n'), 'typescript')

    const result = await scan(index, null)
    const logIssues = result.issues.filter(i => i.ruleId === 'console-log')
    expect(logIssues).toHaveLength(15)
    expect(result.ruleOverflow.get('console-log')).toBe(5)
  })

  it('never caps security findings', async () => {
    let index = createEmptyIndex()
    const lines = Array.from({ length: 20 }, (_, i) => `const r${i} = eval("x${i}")\nel${i}.innerHTML = html${i}`)
    index = indexFile(index, 'src/many-sinks.ts', lines.join('\n'), 'typescript')

    const result = await scan(index, null)
    expect(result.issues.filter(i => i.ruleId === 'eval-usage')).toHaveLength(20)
    expect(result.issues.filter(i => i.ruleId === 'innerhtml-xss')).toHaveLength(20)
    expect(result.ruleOverflow.has('eval-usage')).toBe(false)
    expect(result.ruleOverflow.has('innerhtml-xss')).toBe(false)
  })

  it('never caps multi-line security findings', async () => {
    let index = createEmptyIndex()
    const sites = Array.from({ length: 20 }, (_, i) => `db.query(\n  "SELECT * FROM users WHERE id = " + req.query.id${i}\n)`)
    index = indexFile(index, 'src/many-queries.ts', sites.join('\n'), 'typescript')

    const result = await scan(index, null)
    const reportedLines = new Set(result.issues.filter(i => i.ruleId === 'sql-injection').map(i => i.line))
    const queryLines = Array.from({ length: 20 }, (_, i) => i * 3 + 1)
    expect(queryLines.filter(line => !reportedLines.has(line))).toEqual([])
    expect(result.ruleOverflow.has('sql-injection')).toBe(false)
  })

  it('never caps AST-only eval findings', async () => {
    let index = createEmptyIndex()
    const lines = Array.from({ length: 20 }, (_, i) => `Function("return ${i}")`)
    index = indexFile(index, 'src/many-functions.ts', lines.join('\n'), 'typescript')

    const result = await scan(index, null)
    expect(result.issues.filter(i => i.ruleId === 'eval-usage')).toHaveLength(20)
    expect(result.ruleOverflow.has('eval-usage')).toBe(false)
  })

  it('handles empty index', async () => {
    const index = createEmptyIndex()
    const result = await scan(index, null)
    expect(result.issues).toHaveLength(0)
    expect(result.healthScore).toBe(100)
    expect(result.healthGrade).toBe('A')
  })

  it('handles file with empty string content', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/empty.ts', '', 'typescript')

    const result = await scan(index, null)
    expect(result.scannedFiles).toBe(1)
    expect(result.healthScore).toBeGreaterThanOrEqual(90)
  })

  it('handles non-JS/TS files without false positives', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'styles/app.css', 'body { color: red; }', 'css')
    index = indexFile(index, 'data/config.json', '{ "key": "value" }', 'json')

    const result = await scan(index, null)
    // CSS/JSON should not trigger JS-specific rules like eval-usage or console-log
    const jsRules = result.issues.filter(i =>
      i.ruleId === 'eval-usage' || i.ruleId === 'console-log' || i.ruleId === 'any-type'
    )
    expect(jsRules).toHaveLength(0)
  })

  it('caps health score at 89 (grade B) for security warnings', async () => {
    let index = createEmptyIndex()
    // innerHTML is a security warning
    index = indexFile(index, 'src/render.ts', 'el.innerHTML = userContent', 'typescript')

    const result = await scan(index, null)
    const securityWarnings = result.issues.filter(
      i => i.severity === 'warning' && i.category === 'security'
    )
    if (securityWarnings.length > 0) {
      expect(result.healthScore).toBeLessThanOrEqual(89)
      expect(result.healthGrade).not.toBe('A')
    }
  })

  it('maps health grades correctly at boundaries', async () => {
    // Grade A: 90+, B: 75-89, C: 60-74, D: 40-59, F: 0-39
    let index = createEmptyIndex()
    // Clean code → A
    index = indexFile(index, 'src/clean.ts', 'export const x = 1', 'typescript')
    const cleanResult = await scan(index, null)
    expect(cleanResult.healthGrade).toBe('A')

    // Critical issue → F (score capped at 35 then -30 per critical)
    let critIndex = createEmptyIndex()
    critIndex = indexFile(critIndex, 'src/bad.ts', 'eval(x)\neval(y)', 'typescript')
    const critResult = await scan(critIndex, null)
    expect(critResult.healthGrade).toMatch(/^[D-F]$/)
  })

  it('scans multiple files and aggregates issues', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'console.log("a")', 'typescript')
    index = indexFile(index, 'src/b.ts', 'console.log("b")', 'typescript')
    index = indexFile(index, 'src/c.ts', 'const x = 1', 'typescript')

    const result = await scan(index, null)
    expect(result.scannedFiles).toBe(3)
    const consoleLogs = result.issues.filter(i => i.ruleId === 'console-log')
    expect(consoleLogs.length).toBeGreaterThanOrEqual(2)
    // Issues should come from different files
    const files = new Set(consoleLogs.map(i => i.file))
    expect(files.size).toBeGreaterThanOrEqual(2)
  })

  it('skips vendored paths (node_modules)', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'node_modules/pkg/index.js', 'eval(x)', 'javascript')
    index = indexFile(index, 'src/app.ts', 'const x = 1', 'typescript')

    const result = await scan(index, null)
    const vendoredIssues = result.issues.filter(i => i.file.includes('node_modules'))
    expect(vendoredIssues).toHaveLength(0)
  })
})
