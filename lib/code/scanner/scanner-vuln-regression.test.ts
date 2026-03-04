/**
 * Self-Scan Regression Tests
 *
 * Validates that the scanner's own rule definition files don't trigger
 * high-FP rules (hardcoded-secret, hardcoded-password, eval-usage) after
 * the excludeFiles fix, and includes detection rate report for new rules.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { scanIssues } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import type { CodeIssue } from '@/lib/code/scanner/types'

function scanCode(filename: string, code: string, lang?: string) {
  let index = createEmptyIndex()
  index = indexFile(index, filename, code, lang)
  return scanIssues(index, null)
}

function scanMultiFile(files: Array<{ path: string; code: string; lang?: string }>) {
  let index = createEmptyIndex()
  for (const f of files) {
    index = indexFile(index, f.path, f.code, f.lang)
  }
  return scanIssues(index, null)
}

function issuesForRule(issues: CodeIssue[], ruleId: string) {
  return issues.filter(i => i.ruleId === ruleId)
}

// ============================================================================
// Self-Scan Regression
// ============================================================================

describe('Self-Scan Regression', () => {
  const SCANNER_DIR = join(__dirname)
  const RULE_FILES = [
    'rules-security.ts',
    'rules-security-lang.ts',
    'rules-quality.ts',
    'rules-framework.ts',
    'rules-composite.ts',
  ]

  function readRuleFile(name: string): string {
    try {
      return readFileSync(join(SCANNER_DIR, name), 'utf-8')
    } catch {
      return ''
    }
  }

  it('R1: Self-scan of rule files produces fewer than 100 total issues', () => {
    const files = RULE_FILES
      .map(name => ({
        path: `lib/code/scanner/${name}`,
        code: readRuleFile(name),
        lang: 'typescript' as string,
      }))
      .filter(f => f.code.length > 0)

    expect(files.length).toBeGreaterThanOrEqual(3)

    const result = scanMultiFile(files)
    console.log(`R1: Self-scan total issues: ${result.issues.length}`)
    expect(result.issues.length).toBeLessThan(100)
  })

  it('R2: No hardcoded-secret/password/eval-usage on rule definition files', () => {
    const files = RULE_FILES
      .map(name => ({
        path: `lib/code/scanner/${name}`,
        code: readRuleFile(name),
        lang: 'typescript' as string,
      }))
      .filter(f => f.code.length > 0)

    const result = scanMultiFile(files)

    const secretHits = issuesForRule(result.issues, 'hardcoded-secret')
    const passwordHits = issuesForRule(result.issues, 'hardcoded-password')
    const evalHits = issuesForRule(result.issues, 'eval-usage')

    if (secretHits.length > 0) {
      console.log('R2: hardcoded-secret on rule files:', secretHits.map(h => `${h.file}:${h.line}`))
    }
    if (passwordHits.length > 0) {
      console.log('R2: hardcoded-password on rule files:', passwordHits.map(h => `${h.file}:${h.line}`))
    }
    if (evalHits.length > 0) {
      console.log('R2: eval-usage on rule files:', evalHits.map(h => `${h.file}:${h.line}`))
    }

    expect(secretHits).toHaveLength(0)
    expect(passwordHits).toHaveLength(0)
    expect(evalHits).toHaveLength(0)
  })

  it('R3: Detection rate report — new rules from Groups E/F', () => {
    const detectionTests: Array<{ name: string; detected: boolean; ruleId: string }> = []

    function check(name: string, ruleId: string, code: string, filename: string, lang?: string) {
      const result = scanCode(filename, code, lang)
      const hits = issuesForRule(result.issues, ruleId)
      detectionTests.push({ name, detected: hits.length > 0, ruleId })
    }

    // New rules
    check('NoSQL $where', 'nosql-injection',
      'db.collection.find({ $where: req.body.query })', 'src/api.ts', 'typescript')
    check('NoSQL mapReduce', 'nosql-injection-mapreduce',
      'collection.mapReduce(req.body.mapper, req.body.reducer)', 'src/api.ts', 'typescript')
    check('Prompt injection', 'prompt-injection',
      'const system = `Analyze this: ${req.body.content}`', 'src/ai.ts', 'typescript')
    check('Deprecated TLS', 'deprecated-tls',
      "tls.createServer({ secureProtocol: 'TLSv1_method' })", 'src/server.ts', 'typescript')
    check('localStorage secret', 'localstorage-secret',
      "localStorage.setItem('auth_token', token)", 'src/auth.ts', 'typescript')
    check('Next.js RSC SSRF', 'nextjs-rsc-ssrf',
      'const data = await fetch(apiUrl)', 'src/api.ts', 'typescript')
    check('React localStorage secret', 'localstorage-secret',
      "localStorage.setItem('token', jwt)", 'src/Auth.tsx', 'typescript')
    check('SRI missing CDN', 'sri-missing-cdn',
      '<script src="https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js"></script>',
      'public/index.html')

    // Core rules for aggregate rate
    check('AWS key', 'hardcoded-aws-key',
      'const k = "AKIAIOSFODNN7EXAMPLE1"', 'src/a.ts', 'typescript')
    check('eval', 'eval-usage',
      'eval(userInput)', 'src/a.ts', 'typescript')
    check('SQL injection', 'sql-injection',
      'query(`SELECT * FROM users WHERE id = ${userId}`)', 'src/a.ts', 'typescript')
    check('innerHTML XSS', 'innerhtml-xss',
      'element.innerHTML = data', 'src/a.ts', 'typescript')
    check('CORS wildcard', 'cors-wildcard',
      "res.setHeader('Access-Control-Allow-Origin', '*')", 'src/a.ts', 'typescript')

    const total = detectionTests.length
    const detected = detectionTests.filter(t => t.detected).length
    const missed = detectionTests.filter(t => !t.detected)
    const rate = ((detected / total) * 100).toFixed(1)

    console.log('\n========================================')
    console.log(`NEW RULES DETECTION RATE: ${detected}/${total} (${rate}%)`)
    console.log('========================================')

    if (missed.length > 0) {
      console.log('\nMissed detections:')
      for (const m of missed) {
        console.log(`  - ${m.name} (${m.ruleId})`)
      }
    }

    expect(detected / total).toBeGreaterThanOrEqual(0.8)
  })
})
