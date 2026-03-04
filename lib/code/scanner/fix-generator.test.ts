// Fix Generator — comprehensive unit tests
//
// Tests all FIX_PATTERNS, generateDiff, generateFix, getAllFixSuggestions,
// and edge cases (out-of-range lines, missing patterns, ai-suggested fallback).

import { describe, it, expect } from 'vitest'
import { generateFix, generateDiff, getAllFixSuggestions } from '@/lib/code/scanner/fix-generator'
import type { DiffLine, FixSuggestion } from '@/lib/code/scanner/fix-generator'
import type { CodeIssue } from '@/lib/code/scanner/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: 'test-1',
    ruleId: 'test-rule',
    category: 'security',
    severity: 'critical',
    title: 'Test Issue',
    description: 'A test issue',
    file: 'src/index.ts',
    line: 1,
    column: 0,
    snippet: '',
    ...overrides,
  }
}

function makeFileContent(lines: string[]): string {
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// generateDiff
// ---------------------------------------------------------------------------

describe('generateDiff', () => {
  const sampleFile = makeFileContent([
    'import foo from "foo"',
    'import bar from "bar"',
    'const x = 1',
    'eval(userInput)',
    'const y = 2',
    'export default x',
  ])

  it('produces context + remove + add + context lines', () => {
    const diff = generateDiff('eval(userInput)', 'JSON.parse(userInput)', 4, sampleFile)
    const types = diff.map(d => d.type)
    expect(types).toContain('context')
    expect(types).toContain('remove')
    expect(types).toContain('add')
  })

  it('includes 2 context lines before the change', () => {
    const diff = generateDiff('eval(userInput)', 'JSON.parse(userInput)', 4, sampleFile)
    const contextBefore = diff.filter(d => d.type === 'context' && d.lineNumber < 4)
    expect(contextBefore.length).toBe(2)
    expect(contextBefore[0].content).toBe('import bar from "bar"')
    expect(contextBefore[1].content).toBe('const x = 1')
  })

  it('includes 2 context lines after the change', () => {
    const diff = generateDiff('eval(userInput)', 'JSON.parse(userInput)', 4, sampleFile)
    const contextAfter = diff.filter(d => d.type === 'context' && d.lineNumber > 4)
    expect(contextAfter.length).toBe(2)
    expect(contextAfter[0].content).toBe('const y = 2')
    expect(contextAfter[1].content).toBe('export default x')
  })

  it('shows the remove line with original content', () => {
    const diff = generateDiff('eval(userInput)', 'JSON.parse(userInput)', 4, sampleFile)
    const removed = diff.filter(d => d.type === 'remove')
    expect(removed.length).toBe(1)
    expect(removed[0].content).toBe('eval(userInput)')
    expect(removed[0].lineNumber).toBe(4)
  })

  it('shows the add line with fixed content', () => {
    const diff = generateDiff('eval(userInput)', 'JSON.parse(userInput)', 4, sampleFile)
    const added = diff.filter(d => d.type === 'add')
    expect(added.length).toBe(1)
    expect(added[0].content).toBe('JSON.parse(userInput)')
    expect(added[0].lineNumber).toBe(4)
  })

  it('handles first line of file (no context before)', () => {
    const diff = generateDiff('import foo from "foo"', 'import baz from "baz"', 1, sampleFile)
    const contextBefore = diff.filter(d => d.type === 'context' && d.lineNumber < 1)
    expect(contextBefore.length).toBe(0)
    const removed = diff.find(d => d.type === 'remove')
    expect(removed?.content).toBe('import foo from "foo"')
  })

  it('handles last line of file (no context after)', () => {
    const diff = generateDiff('export default x', 'export default y', 6, sampleFile)
    const contextAfter = diff.filter(d => d.type === 'context' && d.lineNumber > 6)
    expect(contextAfter.length).toBe(0)
  })

  it('handles multi-line original producing multiple remove lines', () => {
    const diff = generateDiff('line one\nline two', 'fixed one\nfixed two', 3, sampleFile)
    const removed = diff.filter(d => d.type === 'remove')
    expect(removed.length).toBe(2)
    expect(removed[0].content).toBe('line one')
    expect(removed[1].content).toBe('line two')
  })
})

// ---------------------------------------------------------------------------
// generateFix — FIX_PATTERNS (security rules)
// ---------------------------------------------------------------------------

describe('generateFix — security patterns', () => {
  describe('eval-usage', () => {
    it('replaces eval() with JSON.parse()', () => {
      const file = makeFileContent(['const result = eval(input)'])
      const fix = generateFix(makeIssue({ ruleId: 'eval-usage', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('JSON.parse(')
      expect(fix!.fixed).not.toContain('eval(')
      expect(fix!.confidence).toBe('auto')
    })

    it('returns null when line has no eval()', () => {
      const file = makeFileContent(['const result = JSON.parse(input)'])
      expect(generateFix(makeIssue({ ruleId: 'eval-usage', line: 1 }), file)).toBeNull()
    })
  })

  describe('innerhtml-xss', () => {
    it('replaces .innerHTML = with .textContent =', () => {
      const file = makeFileContent(['el.innerHTML = userContent'])
      const fix = generateFix(makeIssue({ ruleId: 'innerhtml-xss', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('.textContent =')
    })

    it('returns null for dangerouslySetInnerHTML', () => {
      const file = makeFileContent(['<div dangerouslySetInnerHTML={{ __html: data }} />'])
      expect(generateFix(makeIssue({ ruleId: 'innerhtml-xss', line: 1 }), file)).toBeNull()
    })
  })

  describe('sql-injection', () => {
    it('always returns null (too complex)', () => {
      const file = makeFileContent(['db.query(`SELECT * FROM users WHERE id = ${id}`)'])
      expect(generateFix(makeIssue({ ruleId: 'sql-injection', line: 1 }), file)).toBeNull()
    })
  })

  describe('hardcoded-secret', () => {
    it('replaces hardcoded API key with process.env variable', () => {
      const file = makeFileContent(['const api_key = "sk_live_abcdef1234567890"'])
      const fix = generateFix(makeIssue({ ruleId: 'hardcoded-secret', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('process.env.')
    })

    it('derives env var name from key name', () => {
      const file = makeFileContent(['const client_secret = "a_very_long_secret_value_here"'])
      const fix = generateFix(makeIssue({ ruleId: 'hardcoded-secret', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('process.env.CLIENT_SECRET')
    })

    it('returns null when no secret pattern matches', () => {
      const file = makeFileContent(['const name = "hello"'])
      expect(generateFix(makeIssue({ ruleId: 'hardcoded-secret', line: 1 }), file)).toBeNull()
    })
  })

  describe('hardcoded-password', () => {
    it('replaces hardcoded password with process.env.DB_PASSWORD', () => {
      const file = makeFileContent(['const password = "supersecretpass"'])
      const fix = generateFix(makeIssue({ ruleId: 'hardcoded-password', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('process.env.DB_PASSWORD')
    })

    it('returns null for short passwords (< 4 chars)', () => {
      const file = makeFileContent(['const password = "ab"'])
      expect(generateFix(makeIssue({ ruleId: 'hardcoded-password', line: 1 }), file)).toBeNull()
    })
  })

  describe('cors-wildcard', () => {
    it('replaces wildcard * with specific domain', () => {
      const file = makeFileContent(["origin: '*'"])
      const fix = generateFix(makeIssue({ ruleId: 'cors-wildcard', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('https://your-domain.com')
    })
  })

  describe('weak-hash', () => {
    it('replaces md5 with sha256', () => {
      const file = makeFileContent(["crypto.createHash('md5')"])
      const fix = generateFix(makeIssue({ ruleId: 'weak-hash', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain("'sha256'")
    })

    it('replaces sha1 with sha256', () => {
      const file = makeFileContent(["crypto.createHash('sha1')"])
      const fix = generateFix(makeIssue({ ruleId: 'weak-hash', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain("'sha256'")
    })
  })

  describe('insecure-random', () => {
    it('replaces Math.random() with crypto.randomUUID()', () => {
      const file = makeFileContent(['const token = Math.random().toString(36)'])
      const fix = generateFix(makeIssue({ ruleId: 'insecure-random', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('crypto.randomUUID()')
    })
  })

  describe('cookie-no-httponly', () => {
    it('replaces httpOnly: false with httpOnly: true', () => {
      const file = makeFileContent(['res.cookie("sid", token, { httpOnly: false })'])
      const fix = generateFix(makeIssue({ ruleId: 'cookie-no-httponly', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('httpOnly: true')
    })
  })

  describe('cookie-no-secure', () => {
    it('replaces secure: false with secure: true', () => {
      const file = makeFileContent(['res.cookie("sid", token, { secure: false })'])
      const fix = generateFix(makeIssue({ ruleId: 'cookie-no-secure', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('secure: true')
    })
  })
})

// ---------------------------------------------------------------------------
// generateFix — quality & framework patterns
// ---------------------------------------------------------------------------

describe('generateFix — quality patterns', () => {
  describe('console-log', () => {
    it('replaces console.log() with logger.info()', () => {
      const file = makeFileContent(['console.log("hello")'])
      const fix = generateFix(makeIssue({ ruleId: 'console-log', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('logger.info(')
    })

    it('replaces console.debug() with logger.debug()', () => {
      const file = makeFileContent(['console.debug("debug info")'])
      const fix = generateFix(makeIssue({ ruleId: 'console-log', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('logger.debug(')
    })

    it('replaces console.trace() with logger.debug()', () => {
      const file = makeFileContent(['console.trace("trace info")'])
      const fix = generateFix(makeIssue({ ruleId: 'console-log', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('logger.debug(')
    })

    it('replaces console.info() with logger.info()', () => {
      const file = makeFileContent(['console.info("status")'])
      const fix = generateFix(makeIssue({ ruleId: 'console-log', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('logger.info(')
    })
  })

  describe('any-type', () => {
    it('replaces : any with : unknown', () => {
      const file = makeFileContent(['function foo(x: any) {}'])
      const fix = generateFix(makeIssue({ ruleId: 'any-type', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain(': unknown')
    })

    it('replaces as any with as unknown', () => {
      const file = makeFileContent(['const x = value as any'])
      const fix = generateFix(makeIssue({ ruleId: 'any-type', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('as unknown')
    })

    it('replaces <any> with <unknown>', () => {
      const file = makeFileContent(['const list = new Array<any>()'])
      const fix = generateFix(makeIssue({ ruleId: 'any-type', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('<unknown>')
    })

    it('returns null when no any pattern present', () => {
      const file = makeFileContent(['const x: number = 1'])
      expect(generateFix(makeIssue({ ruleId: 'any-type', line: 1 }), file)).toBeNull()
    })
  })

  describe('empty-catch', () => {
    it('adds error logging to empty catch block', () => {
      const file = makeFileContent(['try { riskyOp() } catch (e) { }'])
      const fix = generateFix(makeIssue({ ruleId: 'empty-catch', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('console.error')
    })

    it('uses existing error variable name', () => {
      const file = makeFileContent(['try { riskyOp() } catch (err) { }'])
      const fix = generateFix(makeIssue({ ruleId: 'empty-catch', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('catch (err)')
    })

    it('returns null when catch block is not empty', () => {
      const file = makeFileContent(['try { riskyOp() } catch (e) { console.error(e) }'])
      expect(generateFix(makeIssue({ ruleId: 'empty-catch', line: 1 }), file)).toBeNull()
    })
  })

  describe('var-usage', () => {
    it('replaces var with const', () => {
      const file = makeFileContent(['var count = 0'])
      const fix = generateFix(makeIssue({ ruleId: 'var-usage', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('const ')
      expect(fix!.fixed).not.toMatch(/\bvar\s/)
    })
  })
})

describe('generateFix — framework patterns', () => {
  describe('django-csrf-exempt', () => {
    it('removes @csrf_exempt decorator', () => {
      const file = makeFileContent(['@csrf_exempt', 'def my_view(request):'])
      const fix = generateFix(makeIssue({ ruleId: 'django-csrf-exempt', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('# @csrf_exempt removed')
    })

    it('returns null when no @csrf_exempt', () => {
      const file = makeFileContent(['def my_view(request):'])
      expect(generateFix(makeIssue({ ruleId: 'django-csrf-exempt', line: 1 }), file)).toBeNull()
    })
  })

  describe('flask-debug-mode', () => {
    it('replaces debug=True with debug=False', () => {
      const file = makeFileContent(['app.run(debug=True)'])
      const fix = generateFix(makeIssue({ ruleId: 'flask-debug-mode', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('debug=False')
    })
  })

  describe('cookie-insecure', () => {
    it('replaces secure: false with secure: true', () => {
      const file = makeFileContent(['{ secure: false, httpOnly: true }'])
      const fix = generateFix(makeIssue({ ruleId: 'cookie-insecure', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain('secure: true')
    })

    it('returns null when secure is already true', () => {
      const file = makeFileContent(['{ secure: true, httpOnly: true }'])
      expect(generateFix(makeIssue({ ruleId: 'cookie-insecure', line: 1 }), file)).toBeNull()
    })
  })

  describe('graphql-introspection-enabled', () => {
    it('replaces introspection: true with env check', () => {
      const file = makeFileContent(['const schema = { introspection: true }'])
      const fix = generateFix(makeIssue({ ruleId: 'graphql-introspection-enabled', line: 1 }), file)
      expect(fix).not.toBeNull()
      expect(fix!.fixed).toContain("process.env.NODE_ENV !== 'production'")
    })
  })
})

// ---------------------------------------------------------------------------
// generateFix — edge cases
// ---------------------------------------------------------------------------

describe('generateFix — edge cases', () => {
  it('returns null when line number is 0', () => {
    const file = makeFileContent(['const x = 1'])
    expect(generateFix(makeIssue({ ruleId: 'eval-usage', line: 0 }), file)).toBeNull()
  })

  it('returns null when line number exceeds file length', () => {
    const file = makeFileContent(['const x = 1'])
    expect(generateFix(makeIssue({ ruleId: 'eval-usage', line: 99 }), file)).toBeNull()
  })

  it('returns null when line number is negative', () => {
    const file = makeFileContent(['const x = 1'])
    expect(generateFix(makeIssue({ ruleId: 'eval-usage', line: -1 }), file)).toBeNull()
  })

  it('returns null when no pattern matches and no issue.fix', () => {
    const file = makeFileContent(['const x = 1'])
    expect(generateFix(makeIssue({ ruleId: 'unknown-rule', line: 1 }), file)).toBeNull()
  })

  it('falls back to issue.fix with ai-suggested confidence', () => {
    const file = makeFileContent(['db.query(`SELECT * FROM users WHERE id = ${id}`)'])
    const issue = makeIssue({
      ruleId: 'sql-injection',
      line: 1,
      fix: 'db.query("SELECT * FROM users WHERE id = ?", [id])',
      fixDescription: 'Use parameterized queries',
    })
    const fix = generateFix(issue, file)
    expect(fix).not.toBeNull()
    expect(fix!.confidence).toBe('ai-suggested')
    expect(fix!.fixed).toBe('db.query("SELECT * FROM users WHERE id = ?", [id])')
    expect(fix!.explanation).toBe('Use parameterized queries')
  })

  it('uses suggestion field when fixDescription is absent', () => {
    const file = makeFileContent(['some code'])
    const issue = makeIssue({
      ruleId: 'completely-unknown',
      line: 1,
      fix: 'fixed code',
      suggestion: 'Fix suggestion text',
    })
    const fix = generateFix(issue, file)
    expect(fix).not.toBeNull()
    expect(fix!.explanation).toBe('Fix suggestion text')
  })

  it('returns correct ruleId in suggestion', () => {
    const file = makeFileContent(['var x = 1'])
    const fix = generateFix(makeIssue({ ruleId: 'var-usage', line: 1 }), file)
    expect(fix!.ruleId).toBe('var-usage')
  })

  it('includes original source line', () => {
    const file = makeFileContent(['var x = 1'])
    const fix = generateFix(makeIssue({ ruleId: 'var-usage', line: 1 }), file)
    expect(fix!.original).toBe('var x = 1')
  })

  it('includes diffLines with remove and add entries', () => {
    const file = makeFileContent(['var x = 1'])
    const fix = generateFix(makeIssue({ ruleId: 'var-usage', line: 1 }), file)
    expect(fix!.diffLines.length).toBeGreaterThan(0)
    expect(fix!.diffLines.some(d => d.type === 'remove')).toBe(true)
    expect(fix!.diffLines.some(d => d.type === 'add')).toBe(true)
  })

  it('returns null when pattern matches but replacement equals original', () => {
    const file = makeFileContent(['const x = crypto.randomUUID()'])
    expect(generateFix(makeIssue({ ruleId: 'insecure-random', line: 1 }), file)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getAllFixSuggestions
// ---------------------------------------------------------------------------

describe('getAllFixSuggestions', () => {
  it('returns empty array for empty issues', () => {
    expect(getAllFixSuggestions([], 'const x = 1')).toEqual([])
  })

  it('returns fix suggestions for all fixable issues', () => {
    const file = makeFileContent(['var count = 0', 'console.log("hello")', 'const token = Math.random()'])
    const issues: CodeIssue[] = [
      makeIssue({ ruleId: 'var-usage', line: 1 }),
      makeIssue({ ruleId: 'console-log', line: 2 }),
      makeIssue({ ruleId: 'insecure-random', line: 3 }),
    ]
    const suggestions = getAllFixSuggestions(issues, file)
    expect(suggestions.length).toBe(3)
  })

  it('filters out null results (unfixable issues)', () => {
    const file = makeFileContent(['db.query(`SELECT * FROM u WHERE id = ${id}`)', 'var count = 0'])
    const issues: CodeIssue[] = [
      makeIssue({ ruleId: 'sql-injection', line: 1 }),
      makeIssue({ ruleId: 'var-usage', line: 2 }),
    ]
    const suggestions = getAllFixSuggestions(issues, file)
    expect(suggestions.length).toBe(1)
    expect(suggestions[0].ruleId).toBe('var-usage')
  })

  it('handles mix of auto and ai-suggested fixes', () => {
    const file = makeFileContent(['var count = 0', 'db.query(`SELECT * FROM u WHERE id = ${id}`)'])
    const issues: CodeIssue[] = [
      makeIssue({ ruleId: 'var-usage', line: 1 }),
      makeIssue({ ruleId: 'sql-injection', line: 2, fix: 'db.query("SELECT * FROM u WHERE id = ?", [id])' }),
    ]
    const suggestions = getAllFixSuggestions(issues, file)
    expect(suggestions.length).toBe(2)
    expect(suggestions[0].confidence).toBe('auto')
    expect(suggestions[1].confidence).toBe('ai-suggested')
  })

  it('handles out-of-range issues gracefully', () => {
    const file = makeFileContent(['const x = 1'])
    const issues: CodeIssue[] = [
      makeIssue({ ruleId: 'eval-usage', line: 99 }),
      makeIssue({ ruleId: 'var-usage', line: 0 }),
    ]
    expect(getAllFixSuggestions(issues, file).length).toBe(0)
  })

  it('preserves issue order in returned suggestions', () => {
    const file = makeFileContent(['console.log("a")', 'var x = 1', "eval('code')"])
    const issues: CodeIssue[] = [
      makeIssue({ ruleId: 'console-log', line: 1 }),
      makeIssue({ ruleId: 'var-usage', line: 2 }),
      makeIssue({ ruleId: 'eval-usage', line: 3 }),
    ]
    const suggestions = getAllFixSuggestions(issues, file)
    expect(suggestions[0].ruleId).toBe('console-log')
    expect(suggestions[1].ruleId).toBe('var-usage')
    expect(suggestions[2].ruleId).toBe('eval-usage')
  })
})
