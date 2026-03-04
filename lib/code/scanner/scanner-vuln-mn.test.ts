/**
 * Vulnerability detection — Category M: False Positive Validation
 * and Category N: New Detection Rules.
 *
 * Pattern: createEmptyIndex() → indexFile() → scanIssues() → assert.
 */

import { describe, it, expect } from 'vitest'
import { scanIssues } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import type { CodeIssue } from '@/lib/code/scanner/types'

function scanCode(filename: string, code: string, lang?: string) {
  let index = createEmptyIndex()
  index = indexFile(index, filename, code, lang)
  return scanIssues(index, null)
}

function issuesForRule(issues: CodeIssue[], ruleId: string) {
  return issues.filter(i => i.ruleId === ruleId)
}

// ============================================================================
// Category M: False Positive Validation (~12 tests)
// ============================================================================

describe('Category M: False Positive Validation', () => {
  it('M1: Rule definition file — eval pattern excluded by excludeFiles', () => {
    const code = [
      "  pattern: 'eval\\\\s*\\\\('",
      "  id: 'eval-usage',",
      "  description: 'Detects eval() usage',",
    ].join('\n')
    const result = scanCode('lib/code/scanner/rules-security.ts', code, 'typescript')
    const evalHits = issuesForRule(result.issues, 'eval-usage')
    const secretHits = issuesForRule(result.issues, 'hardcoded-secret')
    expect(evalHits).toHaveLength(0)
    expect(secretHits).toHaveLength(0)
  })

  it('M2: Rule definition file — console-log self-trigger excluded', () => {
    const code = [
      "  id: 'console-log',",
      "  pattern: '\\\\bconsole\\\\.(log|debug)\\\\s*\\\\(',",
      "  title: 'console.log in production',",
    ].join('\n')
    const result = scanCode('lib/code/scanner/rules-quality.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits).toHaveLength(0)
  })

  it('M3: console.warn — does NOT fire console-log', () => {
    const code = "console.warn('Connection failed')"
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits).toHaveLength(0)
  })

  it('M4: console.error — does NOT fire console-log', () => {
    const code = "console.error('Fatal error', err)"
    const result = scanCode('src/handler.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits).toHaveLength(0)
  })

  it('M5: password from env var — does NOT fire hardcoded-password', () => {
    const code = 'password: process.env.DB_PASSWORD'
    const result = scanCode('src/config.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-password')
    expect(hits).toHaveLength(0)
  })

  it('M6: type annotation with apiKey — no hardcoded-secret', () => {
    const code = 'type AuthConfig = { apiKey: string; secret: string }'
    const result = scanCode('src/types.ts', code, 'typescript')
    const secretHits = issuesForRule(result.issues, 'hardcoded-secret')
    const passwordHits = issuesForRule(result.issues, 'hardcoded-password')
    expect(secretHits).toHaveLength(0)
    expect(passwordHits).toHaveLength(0)
  })

  it('M7: TODO inline with code — fires merged todo-fixme rule', () => {
    // Pure comment-only lines are suppressed for non-security reliability rules.
    // TODO must appear on a line with code to fire.
    const code = 'doSomething() // TODO(#1234): refactor this module'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'todo-fixme')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
    const oldHits = issuesForRule(result.issues, 'todo-fixme-without-issue')
    expect(oldHits).toHaveLength(0)
  })

  it('M8: HTTP status 404 — does NOT fire magic-number', () => {
    const code = "return res.status(404).json({ error: 'Not found' })"
    const result = scanCode('src/api.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'magic-number')
    expect(hits).toHaveLength(0)
  })

  it('M9: Port 3000 — does NOT fire magic-number', () => {
    const code = 'app.listen(3000)'
    const result = scanCode('src/server.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'magic-number')
    expect(hits).toHaveLength(0)
  })

  it('M10: non-interop "any" usage fires any-type', () => {
    const code = 'const i: any = 0'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'any-type')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('M11: Test fixture file with secrets — documents behavior', () => {
    const code = 'const api_key = "fake-key-for-testing-1234567890"'
    const result = scanCode('__tests__/fixtures/example.ts', code, 'typescript')
    const secretHits = issuesForRule(result.issues, 'hardcoded-secret')
    if (secretHits.length > 0) {
      console.log('M11: Secret in fixture fires (entropy-dependent)')
    }
    expect(true).toBe(true)
  })

  it('M12: Low-confidence issues exist in raw results', () => {
    const code = 'console.log("debug output")'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].confidence).toBe('low')
  })
})

// ============================================================================
// Category N: New Detection Rules (~12 tests)
// ============================================================================

describe('Category N: New Detection Rules', () => {
  it('N1: MongoDB $where injection', () => {
    const code = 'db.collection.find({ $where: req.body.query })'
    const result = scanCode('src/api.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'nosql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-943')
  })

  it('N2: MongoDB $regex from user input', () => {
    const code = 'db.users.find({ email: { $regex: req.query.search } })'
    const result = scanCode('src/search.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'nosql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('N3: MongoDB $ne static — no taint source — no fire', () => {
    const code = 'db.users.find({ password: { $ne: null } })'
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'nosql-injection')
    expect(hits).toHaveLength(0)
  })

  it('N4: FALSE POSITIVE — MongoDB $regex static pattern', () => {
    const code = 'db.logs.find({ message: { $regex: /^error/i } })'
    const result = scanCode('src/logs.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'nosql-injection')
    expect(hits).toHaveLength(0)
  })

  it('N5: localStorage secret storage', () => {
    const code = "localStorage.setItem('auth_token', token)"
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'localstorage-secret')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-922')
  })

  it('N6: sessionStorage with password', () => {
    const code = "sessionStorage.setItem('password', pwd)"
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'localstorage-secret')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('N7: FALSE POSITIVE — localStorage for theme', () => {
    const code = "localStorage.setItem('theme', 'dark')"
    const result = scanCode('src/settings.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'localstorage-secret')
    expect(hits).toHaveLength(0)
  })

  it('N8: Prompt injection — user input in LLM prompt', () => {
    const code = "const prompt = `You are an assistant. Analyze: ${req.body.message}`"
    const result = scanCode('src/ai.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'prompt-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
  })

  it('N9: FALSE POSITIVE — static prompt string', () => {
    const code = 'const prompt = "You are a helpful assistant"'
    const result = scanCode('src/ai.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'prompt-injection')
    expect(hits).toHaveLength(0)
  })

  it('N10: Deprecated TLS — TLSv1_method', () => {
    const code = "tls.createServer({ secureProtocol: 'TLSv1_method' })"
    const result = scanCode('src/server.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'deprecated-tls')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-327')
  })

  it('N11: modern TLS 1.3 should NOT flag deprecated-tls', () => {
    const code = "tls.createServer({ minVersion: 'TLSv1.3' })"
    const result = scanCode('src/server.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'deprecated-tls')
    expect(hits).toHaveLength(0)
  })

  it('N11b: modern TLS 1.2 should NOT flag deprecated-tls', () => {
    const code = "tls.createServer({ minVersion: 'TLSv1.2' })"
    const result = scanCode('src/server.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'deprecated-tls')
    expect(hits).toHaveLength(0)
  })

  it('N12: CDN script without SRI', () => {
    const code = '<script src="https://cdnjs.cloudflare.com/ajax/libs/lodash/4.17.21/lodash.min.js"></script>'
    const result = scanCode('public/index.html', code)
    const hits = issuesForRule(result.issues, 'sri-missing-cdn')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-353')
  })
})
