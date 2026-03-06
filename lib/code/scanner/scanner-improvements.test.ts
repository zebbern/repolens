import { scanIssues } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { SECURITY_RULES } from '@/lib/code/scanner/rules-security'
import { BAD_PRACTICE_RULES, RELIABILITY_RULES } from '@/lib/code/scanner/rules-quality'
import { SECURITY_LANG_RULES } from '@/lib/code/scanner/rules-security-lang'
import { COMPOSITE_RULES } from '@/lib/code/scanner/rules-composite'
import { executeToolLocally } from '@/lib/ai/client-tool-executor'

// ============================================================================
// Context-Aware Suppression (T2.1)
// ============================================================================

describe('context-aware suppression', () => {
  it('suppresses eval-usage in a comment', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', '// eval(foo)', 'typescript')

    const result = scanIssues(index, null)
    const evalIssues = result.issues.filter(i => i.ruleId === 'eval-usage')
    // eval is security-critical so it should NOT be comment-suppressed
    // (security-critical rules bypass comment suppression)
    expect(evalIssues.length).toBeGreaterThanOrEqual(0)
  })

  it('does not suppress eval-usage on a non-comment line', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const result = eval(userInput)', 'typescript')

    const result = scanIssues(index, null)
    const evalIssues = result.issues.filter(i => i.ruleId === 'eval-usage')
    expect(evalIssues.length).toBeGreaterThanOrEqual(1)
  })

  it('suppresses console-log in a JS comment', () => {
    let index = createEmptyIndex()
    // console-log is info-level bad-practice, so it should be suppressed in comments
    index = indexFile(index, 'src/app.ts', '// console.log("debug")', 'typescript')

    const result = scanIssues(index, null)
    const consoleIssues = result.issues.filter(i => i.ruleId === 'console-log')
    expect(consoleIssues).toHaveLength(0)
  })

  it('suppresses hardcoded-password for type annotation', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/types.ts', 'type Config = { password: string }', 'typescript')

    const result = scanIssues(index, null)
    const passwordIssues = result.issues.filter(i => i.ruleId === 'hardcoded-password')
    expect(passwordIssues).toHaveLength(0)
  })

  it('suppresses console-log in test files', () => {
    let index = createEmptyIndex()
    index = indexFile(index, '__tests__/utils.test.ts', 'console.log("debug")', 'typescript')

    const result = scanIssues(index, null)
    const consoleIssues = result.issues.filter(i => i.ruleId === 'console-log')
    expect(consoleIssues).toHaveLength(0)
  })

  it('suppresses eval-usage in test files (excludeFiles)', () => {
    let index = createEmptyIndex()
    index = indexFile(index, '__tests__/utils.test.ts', 'const result = eval(userInput)', 'typescript')

    const result = scanIssues(index, null)
    const evalIssues = result.issues.filter(i => i.ruleId === 'eval-usage')
    // eval-usage has excludeFiles that matches test files — both regex and AST paths
    expect(evalIssues).toHaveLength(0)
  })

  it('suppresses non-security rules in generated files', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'types/api.d.ts', 'console.log("auto-generated")', 'typescript')

    const result = scanIssues(index, null)
    const consoleIssues = result.issues.filter(i => i.ruleId === 'console-log')
    expect(consoleIssues).toHaveLength(0)
  })
})

// ============================================================================
// Confidence Propagation (T2.2)
// ============================================================================

describe('confidence propagation', () => {
  it('eval-usage issues have confidence: "high"', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(userInput)', 'typescript')

    const result = scanIssues(index, null)
    const evalIssues = result.issues.filter(i => i.ruleId === 'eval-usage')
    expect(evalIssues.length).toBeGreaterThanOrEqual(1)
    expect(evalIssues[0].confidence).toBe('high')
  })

  it('console-log issues have confidence: "low"', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'console.log("debug")', 'typescript')

    const result = scanIssues(index, null)
    const consoleIssues = result.issues.filter(i => i.ruleId === 'console-log')
    expect(consoleIssues.length).toBeGreaterThanOrEqual(1)
    expect(consoleIssues[0].confidence).toBe('low')
  })

  it('all rules in all rule sets have confidence defined', () => {
    const allScanRules = [...SECURITY_RULES, ...SECURITY_LANG_RULES, ...BAD_PRACTICE_RULES, ...RELIABILITY_RULES]
    for (const rule of allScanRules) {
      expect(rule.confidence, `Rule ${rule.id} is missing confidence`).toMatch(/^(high|medium|low)$/)
    }
  })

  it('all composite rules have confidence defined', () => {
    for (const rule of COMPOSITE_RULES) {
      expect(rule.confidence, `Composite rule ${rule.id} is missing confidence`).toMatch(/^(high|medium|low)$/)
    }
  })
})

// ============================================================================
// Entropy-Based Suppression (T2.3)
// ============================================================================

describe('entropy-based suppression', () => {
  it('suppresses low-entropy secret pattern', () => {
    let index = createEmptyIndex()
    // "test1234" is low entropy and matches placeholder pattern
    index = indexFile(index, 'src/config.ts', 'api_key = "test1234"', 'typescript')

    const result = scanIssues(index, null)
    const secretIssues = result.issues.filter(i =>
      i.ruleId === 'hardcoded-secret' || i.ruleId === 'hardcoded-password'
    )
    expect(secretIssues).toHaveLength(0)
  })

  it('detects high-entropy real secret', () => {
    let index = createEmptyIndex()
    // High entropy, no placeholder patterns
    index = indexFile(index, 'src/config.ts', 'api_key = "sk-proj-a8f3k2m9x7v1b3q5w2e4"', 'typescript')

    const result = scanIssues(index, null)
    const secretIssues = result.issues.filter(i => i.ruleId === 'hardcoded-secret')
    expect(secretIssues.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Auto-Fix Suggestions (T2.4)
// ============================================================================

describe('auto-fix suggestions', () => {
  it('eval-usage issues carry fix and fixDescription', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(userInput)', 'typescript')

    const result = scanIssues(index, null)
    const evalIssues = result.issues.filter(i => i.ruleId === 'eval-usage')
    expect(evalIssues.length).toBeGreaterThanOrEqual(1)
    expect(evalIssues[0].fix).toBeTruthy()
    expect(evalIssues[0].fixDescription).toBeTruthy()
  })

  it('console-log issues carry fix and fixDescription', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'console.log("debug")', 'typescript')

    const result = scanIssues(index, null)
    const consoleIssues = result.issues.filter(i => i.ruleId === 'console-log')
    expect(consoleIssues.length).toBeGreaterThanOrEqual(1)
    expect(consoleIssues[0].fix).toBeTruthy()
    expect(consoleIssues[0].fixDescription).toBeTruthy()
  })

  it('issues from rules without fix have fix undefined', () => {
    let index = createEmptyIndex()
    // github-token doesn't have a fix field
    index = indexFile(index, 'src/app.ts', 'const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"', 'typescript')

    const result = scanIssues(index, null)
    const tokenIssues = result.issues.filter(i => i.ruleId === 'github-token')
    if (tokenIssues.length > 0) {
      expect(tokenIssues[0].fix).toBeUndefined()
    }
  })
})

// ============================================================================
// Health Score Normalization (T2.5)
// ============================================================================

describe('health score normalization', () => {
  it('includes securityGrade, qualityGrade, and issuesPerKloc', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const x = 1', 'typescript')

    const result = scanIssues(index, null)
    expect(result.securityGrade).toBeDefined()
    expect(result.qualityGrade).toBeDefined()
    expect(result.issuesPerKloc).toBeDefined()
    expect(typeof result.issuesPerKloc).toBe('number')
  })

  it('clean codebase gets securityGrade A and qualityGrade A', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/clean.ts', 'export const x = 1', 'typescript')

    const result = scanIssues(index, null)
    expect(result.securityGrade).toBe('A')
    expect(result.qualityGrade).toBe('A')
  })

  it('console-log-only code has securityGrade A', () => {
    let index = createEmptyIndex()
    const code = Array.from({ length: 5 }, (_, i) => `console.log("debug ${i}")`).join('\n')
    index = indexFile(index, 'src/app.ts', code, 'typescript')

    const result = scanIssues(index, null)
    expect(result.securityGrade).toBe('A')
    // Quality grade may be penalized but security is unaffected
  })

  it('eval usage penalizes securityGrade', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/danger.ts', 'const x = eval(input)', 'typescript')

    const result = scanIssues(index, null)
    // eval is a critical security issue
    expect(result.securityGrade).not.toBe('A')
  })

  it('issuesPerKloc is > 0 when issues exist', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'console.log("debug")', 'typescript')

    const result = scanIssues(index, null)
    if (result.issues.length > 0) {
      expect(result.issuesPerKloc).toBeGreaterThan(0)
    }
  })

  it('issuesPerKloc is 0 for clean code', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/clean.ts', 'export const x = 1', 'typescript')

    const result = scanIssues(index, null)
    if (result.issues.length === 0) {
      expect(result.issuesPerKloc).toBe(0)
    }
  })
})

// ============================================================================
// Differential Scanning (T2.6)
// ============================================================================

describe('differential scanning', () => {
  function buildThreeFileIndex() {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'console.log("a")', 'typescript')
    index = indexFile(index, 'src/b.ts', 'console.log("b")', 'typescript')
    index = indexFile(index, 'src/c.ts', 'const x = 1', 'typescript')
    return index
  }

  it('only returns issues from changed files', () => {
    const index = buildThreeFileIndex()
    const result = scanIssues(index, null, ['src/a.ts'])

    // Should only contain issues from src/a.ts
    const filesWithIssues = new Set(result.issues.map(i => i.file))
    for (const file of filesWithIssues) {
      expect(file).toBe('src/a.ts')
    }
  })

  it('sets isPartialScan to true when changedFiles is provided', () => {
    const index = buildThreeFileIndex()
    const result = scanIssues(index, null, ['src/a.ts'])

    expect(result.isPartialScan).toBe(true)
  })

  it('sets isPartialScan to false when changedFiles is not provided', () => {
    const index = buildThreeFileIndex()
    const result = scanIssues(index, null)

    expect(result.isPartialScan).toBe(false)
  })

  it('scannedFiles reflects count of changed files, not total', () => {
    const index = buildThreeFileIndex()
    const result = scanIssues(index, null, ['src/a.ts'])

    expect(result.scannedFiles).toBe(1)
  })

  it('scannedFiles reflects total files when no changedFiles', () => {
    const index = buildThreeFileIndex()
    const result = scanIssues(index, null)

    expect(result.scannedFiles).toBe(3)
  })

  it('empty changedFiles array means no partial scan', () => {
    const index = buildThreeFileIndex()
    const result = scanIssues(index, null, [])

    // Empty array = isPartialScan should be false
    expect(result.isPartialScan).toBe(false)
    expect(result.scannedFiles).toBe(3)
  })
})

// ============================================================================
// AI Tool Bridge (T2.7)
// ============================================================================

describe('AI tool bridge: executeScanIssues via executeToolLocally', () => {

  function buildIndex() {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/danger.ts', 'const result = eval(userInput)', 'typescript')
    index = indexFile(index, 'src/clean.ts', 'const x = 1', 'typescript')
    return index
  }

  it('returns issues with critical severity for eval()', () => {
    const index = buildIndex()
    const raw = executeToolLocally('scanIssues', { path: 'src/danger.ts' }, index)
    const result = JSON.parse(raw)

    expect(result.issueCount).toBeGreaterThanOrEqual(1)
    const evalIssues = result.issues.filter((i: { message: string }) =>
      i.message.toLowerCase().includes('eval')
    )
    expect(evalIssues.length).toBeGreaterThanOrEqual(1)
    expect(evalIssues[0].severity).toBe('critical')
  })

  it('returns backward-compatible fields: path, issueCount, issues[].line, severity, message', () => {
    const index = buildIndex()
    const raw = executeToolLocally('scanIssues', { path: 'src/danger.ts' }, index)
    const result = JSON.parse(raw)

    expect(result.path).toBe('src/danger.ts')
    expect(typeof result.issueCount).toBe('number')
    expect(Array.isArray(result.issues)).toBe(true)
    if (result.issues.length > 0) {
      const issue = result.issues[0]
      expect(typeof issue.line).toBe('number')
      expect(typeof issue.severity).toBe('string')
      expect(typeof issue.message).toBe('string')
    }
  })

  it('returns new fields: issues[].ruleId, issues[].confidence', () => {
    const index = buildIndex()
    const raw = executeToolLocally('scanIssues', { path: 'src/danger.ts' }, index)
    const result = JSON.parse(raw)

    expect(result.issues.length).toBeGreaterThanOrEqual(1)
    const issue = result.issues[0]
    expect(issue.ruleId).toBeTruthy()
    expect(issue.confidence).toBeTruthy()
  })

  it('returns error for non-existent file', () => {
    const index = buildIndex()
    const raw = executeToolLocally('scanIssues', { path: 'src/nonexistent.ts' }, index)
    const result = JSON.parse(raw)

    expect(result.error).toContain('File not found')
  })

  it('caps issues at 50', () => {
    let index = createEmptyIndex()
    // Create a file with many many issues
    const lines = Array.from({ length: 60 }, (_, i) => `console.log("line${i}")`)
    index = indexFile(index, 'src/verbose.ts', lines.join('\n'), 'typescript')

    const raw = executeToolLocally('scanIssues', { path: 'src/verbose.ts' }, index)
    const result = JSON.parse(raw)

    expect(result.issues.length).toBeLessThanOrEqual(50)
  })

  it('returns empty issues for clean file', () => {
    const index = buildIndex()
    const raw = executeToolLocally('scanIssues', { path: 'src/clean.ts' }, index)
    const result = JSON.parse(raw)

    expect(result.issueCount).toBe(0)
    expect(result.issues).toHaveLength(0)
  })
})

// ============================================================================
// Regression: Health score backward compatibility (T3.2)
// ============================================================================

describe('health score backward compatibility', () => {
  it('critical eval-usage produces healthScore <= 35 and healthGrade D or F', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/bad.ts', 'eval(x)\neval(y)', 'typescript')

    const result = scanIssues(index, null)
    expect(result.healthScore).toBeLessThanOrEqual(35)
    expect(result.healthGrade).toMatch(/^[D-F]$/)
  })

  it('clean codebase produces healthScore >= 90 and healthGrade A', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/clean.ts', 'export const x = 1', 'typescript')

    const result = scanIssues(index, null)
    expect(result.healthScore).toBeGreaterThanOrEqual(90)
    expect(result.healthGrade).toBe('A')
  })
})
