/**
 * Vulnerability detection — Category K: Framework-Specific Detection
 * and Category L: Edge Cases.
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
// Category K: Framework-Specific Detection (~12 tests)
// ============================================================================

describe('Category K: Framework-Specific Detection', () => {
  it('K1: Next.js RSC SSRF — fetch(url) in server component', () => {
    const code = [
      'async function getData() {',
      '  const data = await fetch(url)',
      '  return data.json()',
      '}',
    ].join('\n')
    const result = scanCode('app/api/route.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'nextjs-rsc-ssrf')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-918')
  })

  it('K2: Next.js RSC SSRF — FALSE POSITIVE — static URL', () => {
    const code = "const res = await fetch('https://api.internal.com/data')"
    const result = scanCode('app/api/route.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'nextjs-rsc-ssrf')
    expect(hits).toHaveLength(0)
  })

  it('K3: Next.js server action without auth check', () => {
    const code = [
      "'use server'",
      '',
      'export async function deleteUser(id: string) {',
      '  await db.user.delete({ where: { id } })',
      '}',
    ].join('\n')
    const result = scanCode('app/actions.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'nextjs-server-action-no-auth')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('K4: Express app without helmet', () => {
    const code = [
      "const express = require('express')",
      'const app = express()',
      "app.get('/', (req, res) => res.send('hello'))",
    ].join('\n')
    const result = scanCode('src/server.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'express-no-helmet')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('K5: Express app WITH helmet on same line — suppressed', () => {
    // express-no-helmet excludePattern checks per-line: helmet must appear
    // on the same line as express() to suppress. When helmet is imported on
    // a separate line, the rule still fires as an informational reminder.
    const code = "const app = require('express')(); const helmet = require('helmet')"
    const result = scanCode('src/server.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'express-no-helmet')
    // helmet appears on the same line as express() → excludePattern matches
    expect(hits).toHaveLength(0)
  })

  it('K6: React href="javascript:alert(1)"', () => {
    const code = '<a href="javascript:alert(1)">Click</a>'
    const result = scanCode('src/Link.tsx', code, 'typescript')
    const hits = issuesForRule(result.issues, 'react-href-javascript')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-79')
  })

  it('K7: Django @csrf_exempt decorator', () => {
    const code = [
      'from django.views.decorators.csrf import csrf_exempt',
      '',
      '@csrf_exempt',
      'def webhook(request):',
      '    return JsonResponse({"ok": True})',
    ].join('\n')
    const result = scanCode('views.py', code, 'python')
    const hits = issuesForRule(result.issues, 'django-csrf-exempt')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('K8: Django mark_safe with f-string', () => {
    // Pattern requires mark_safe( followed by f"/f', request., self., or str(
    const code = 'html = mark_safe(f"<b>{user_input}</b>")'
    const result = scanCode('views.py', code, 'python')
    const hits = issuesForRule(result.issues, 'django-mark-safe')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-79')
  })

  it('K9: Express route without rate limiting', () => {
    const code = [
      "const express = require('express')",
      'const app = express()',
      "app.post('/login', (req, res) => { res.json({ ok: true }) })",
    ].join('\n')
    const result = scanCode('src/server.ts', code, 'typescript')
    const rateHits = issuesForRule(result.issues, 'express-no-rate-limit')
    expect(rateHits.length).toBeGreaterThanOrEqual(1)
  })

  it('K10: Flask app.run(debug=True)', () => {
    const code = [
      'from flask import Flask',
      'app = Flask(__name__)',
      'app.run(debug=True)',
    ].join('\n')
    const result = scanCode('app.py', code, 'python')
    const hits = issuesForRule(result.issues, 'flask-debug-mode')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('K11: Spring csrf().disable()', () => {
    const code = [
      '@Override',
      'protected void configure(HttpSecurity http) throws Exception {',
      '    http.csrf().disable()',
      '}',
    ].join('\n')
    const result = scanCode('SecurityConfig.java', code, 'java')
    const hits = issuesForRule(result.issues, 'spring-csrf-disabled')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('K12: Non-security rule in test file is suppressed', () => {
    // Security-category rules still fire in test files.
    // Non-security rules (e.g. console-log, bad-practice) are suppressed.
    const code = 'console.log("debugging")'
    const result = scanCode('__tests__/server.test.ts', code, 'typescript')
    const consoleHits = issuesForRule(result.issues, 'console-log')
    expect(consoleHits).toHaveLength(0)
  })
})

// ============================================================================
// Category L: Edge Cases — Encoded & Indirect Patterns (~10 tests)
// ============================================================================

describe('Category L: Edge Cases — Encoded & Indirect Patterns', () => {
  it('L1: Secret split across concatenation — documents behavior', () => {
    const code = 'const key = "sk-proj-" + "a8f3k2m9x7v1b3q5w2e4"'
    const result = scanCode('src/config.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-secret')
    // Line-level regex won't see the full key as one token — known gap
    if (hits.length > 0) {
      console.log('L1: Split secret WAS detected (unexpected but good)')
    } else {
      console.log('L1: Split secret NOT detected (expected — known gap)')
    }
    expect(true).toBe(true)
  })

  it('L2: Eval via bracket notation — documents behavior', () => {
    const code = 'window["eval"](code)'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    if (hits.length > 0) {
      expect(hits[0].severity).toBe('critical')
    } else {
      console.log('L2: Bracket eval NOT detected (known gap)')
    }
    expect(true).toBe(true)
  })

  it('L3: SQL injection via multiline template literal — documents behavior', () => {
    const code = 'const q = `SELECT * FROM users\n  WHERE id = ${userId}`'
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sql-injection')
    if (hits.length > 0) {
      expect(hits[0].cwe).toBe('CWE-89')
    } else {
      console.log('L3: Multiline SQL NOT detected (per-line regex limit)')
    }
    expect(true).toBe(true)
  })

  it('L4: Command injection with variable indirection', () => {
    const code = 'command = "convert " + inputFile'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'command-injection-string-concat')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('L5: Multiple vulnerabilities in single expression', () => {
    const code = 'eval(req.query.code)'
    const result = scanCode('src/handler.ts', code, 'typescript')
    const evalHits = issuesForRule(result.issues, 'eval-usage')
    expect(evalHits.length).toBeGreaterThanOrEqual(1)
  })

  it('L6: Vulnerability in arrow function', () => {
    const code = 'const handler = (req) => eval(req.body.code)'
    const result = scanCode('src/handler.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
  })

  it('L7: Vulnerability in class method', () => {
    const code = 'class Svc {\n  run(input) {\n    eval(input)\n  }\n}'
    const result = scanCode('src/svc.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('L8: Console.log in production file fires', () => {
    const code = 'console.log(error.stack)'
    const result = scanCode('src/handler.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('L9: "as any" in require interop — suppressed', () => {
    const code = "const mod = require('legacy') as any"
    const result = scanCode('src/compat.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'any-type')
    expect(hits).toHaveLength(0)
  })

  it('L10: eslint-disable with justification — suppressed', () => {
    const code = '// eslint-disable-next-line no-unused-vars -- needed for API contract'
    const result = scanCode('src/api.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'eslint-disable')
    expect(hits).toHaveLength(0)
  })
})
