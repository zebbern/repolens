/**
 * Comprehensive vulnerability detection test suite.
 *
 * Tests 126 scenarios across 10 categories (A–J), validating that the scanner
 * correctly detects vulnerabilities AND suppresses false positives.
 *
 * Pattern: createEmptyIndex() → indexFile() → scanIssues() → assert on ruleId,
 * severity, cwe, confidence.
 */

import { describe, it, expect } from 'vitest'
import { scanIssues } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import type { CodeIssue } from '@/lib/code/scanner/types'

// ============================================================================
// Shared helpers
// ============================================================================

/** Scan a single file and return all issues. */
function scanCode(filename: string, code: string, lang?: string) {
  let index = createEmptyIndex()
  index = indexFile(index, filename, code, lang)
  return scanIssues(index, null)
}

/** Scan multiple files and return the combined result. */
function scanMultiFile(files: Array<{ path: string; code: string; lang?: string }>) {
  let index = createEmptyIndex()
  for (const f of files) {
    index = indexFile(index, f.path, f.code, f.lang)
  }
  return scanIssues(index, null)
}

/** Filter issues by ruleId from a scan result. */
function issuesForRule(issues: CodeIssue[], ruleId: string) {
  return issues.filter(i => i.ruleId === ruleId)
}

// ============================================================================
// Category A: Secrets & Credentials (~15 tests)
// ============================================================================

describe('Category A: Secrets & Credentials', () => {
  it('A1: detects AWS access key (AKIA prefix)', () => {
    const result = scanCode('src/config.ts', 'const key = "AKIAIOSFODNN7EXAMPLE1"', 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-aws-key')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-798')
  })

  it('A2: detects ASIA-prefixed AWS temporary key', () => {
    const result = scanCode('src/config.ts', 'const key = "ASIAXYZ123456789ABCD"', 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-aws-key')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('A3: detects api_key with high-entropy value', () => {
    const result = scanCode('src/config.ts', 'api_key = "sk-proj-a8f3k2m9x7v1b3q5w2e4"', 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-secret')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
  })

  it('A4: detects various secret key names', () => {
    const names = ['api_secret', 'secret_key', 'access_token', 'auth_token', 'client_secret']
    for (const name of names) {
      const result = scanCode('src/config.ts', `${name} = "a8f3k2m9x7v1b3q5w2e4"`, 'typescript')
      const hits = issuesForRule(result.issues, 'hardcoded-secret')
      expect(hits.length, `Expected hardcoded-secret for ${name}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('A5: detects hardcoded password', () => {
    const result = scanCode('src/config.ts', 'password = "r3alP@ssw0rd!xyz9"', 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-password')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-259')
  })

  it('A6: detects RSA private key marker', () => {
    const result = scanCode('src/keys.ts', '-----BEGIN RSA PRIVATE KEY-----', 'typescript')
    const hits = issuesForRule(result.issues, 'private-key-inline')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-321')
  })

  it('A7: detects EC and OPENSSH private key variants', () => {
    const ec = scanCode('src/keys.ts', '-----BEGIN EC PRIVATE KEY-----', 'typescript')
    expect(issuesForRule(ec.issues, 'private-key-inline').length).toBeGreaterThanOrEqual(1)

    const openssh = scanCode('src/keys.ts', '-----BEGIN OPENSSH PRIVATE KEY-----', 'typescript')
    expect(issuesForRule(openssh.issues, 'private-key-inline').length).toBeGreaterThanOrEqual(1)
  })

  it('A8: detects GitHub PAT (ghp_ prefix)', () => {
    // Pattern: ghp_[A-Za-z0-9_]{36} — exactly 36 chars after prefix
    const result = scanCode('src/app.ts', 'const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"', 'typescript')
    const hits = issuesForRule(result.issues, 'github-token')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].confidence).toBe('high')
  })

  it('A9: detects GitHub OAuth (gho_) and app token (ghs_)', () => {
    // Pattern: gho_/ghs_[A-Za-z0-9_]{36} — exactly 36 chars after prefix
    const gho = scanCode('src/app.ts', 'const t = "gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"', 'typescript')
    expect(issuesForRule(gho.issues, 'github-token').length).toBeGreaterThanOrEqual(1)

    const ghs = scanCode('src/app.ts', 'const t = "ghs_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"', 'typescript')
    expect(issuesForRule(ghs.issues, 'github-token').length).toBeGreaterThanOrEqual(1)
  })

  it('A10: FALSE POSITIVE — password from env var not flagged', () => {
    const result = scanCode('src/config.ts', 'password: process.env.DB_PASSWORD', 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-password')
    expect(hits).toHaveLength(0)
  })

  it('A11: FALSE POSITIVE — placeholder api_key not flagged', () => {
    const result = scanCode('src/config.ts', 'api_key = "your-api-key-here"', 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-secret')
    expect(hits).toHaveLength(0)
  })

  it('A12: FALSE POSITIVE — type annotation with password not flagged', () => {
    const result = scanCode('src/types.ts', 'type Config = { password: string }', 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-password')
    expect(hits).toHaveLength(0)
  })

  it('A13: FALSE POSITIVE — low-entropy placeholder not flagged', () => {
    const result = scanCode('src/config.ts', 'api_key = "test1234"', 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-secret')
    expect(hits).toHaveLength(0)
  })

  it('A14: detects password in Python file', () => {
    const result = scanCode('src/config.py', 'password = "x8k2m9v4b7n1q3w5z6"', 'python')
    const hits = issuesForRule(result.issues, 'hardcoded-password')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('A15: detects secret in multi-line object', () => {
    const code = `const config = {\n  secret_key: "a8f3k2m9x7v1b3q5w2e4"\n}`
    const result = scanCode('src/config.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-secret')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Category B: Injection — SQL (~10 tests)
// ============================================================================

describe('Category B: Injection — SQL', () => {
  it('B1: detects JS template literal SQL injection', () => {
    const code = 'query(`SELECT * FROM users WHERE id = ${userId}`)'
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-89')
  })

  it('B2: detects JS string concatenation SQL injection', () => {
    const code = 'query("SELECT * FROM users WHERE id = " + userId)'
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('B3: FALSE POSITIVE — prepared statement not flagged', () => {
    const code = "query('SELECT * FROM users WHERE id = $1', [userId])"
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sql-injection')
    expect(hits).toHaveLength(0)
  })

  it('B4: detects Go SQL concatenation', () => {
    const code = 'db.QueryContext(ctx, fmt.Sprintf("SELECT * FROM users WHERE id = %s", id))'
    const result = scanCode('src/db.go', code, 'go')
    const hits = issuesForRule(result.issues, 'go-sql-concat')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('B5: detects Java SQL concatenation', () => {
    const code = 'Statement stmt = conn.createStatement(); stmt.executeQuery("SELECT * FROM users WHERE name = \'" + name + "\'")'
    const result = scanCode('src/Dao.java', code, 'java')
    const hits = issuesForRule(result.issues, 'java-sql-concat')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('B6: detects PHP SQL injection', () => {
    const code = '$conn->query("SELECT * FROM users WHERE id = $id")'
    const result = scanCode('src/db.php', code, 'php')
    const hits = issuesForRule(result.issues, 'php-sql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('B7: detects case-insensitive SQL keywords', () => {
    const code = 'query("select * from users where id = " + id)'
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('B8: detects INSERT statement injection', () => {
    const code = "execute(\"INSERT INTO logs VALUES ('\" + data + \"')\")"
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('B9: detects DELETE statement injection', () => {
    const code = 'query("DELETE FROM users WHERE id = " + id)'
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('B10: detects UPDATE statement injection', () => {
    const code = "execute(\"UPDATE users SET name = '\" + name + \"' WHERE id = \" + id)"
    const result = scanCode('src/db.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sql-injection')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Category C: Injection — Command (~18 tests)
// ============================================================================

describe('Category C: Injection — Command', () => {
  it('C1: detects eval(userInput)', () => {
    const result = scanCode('src/app.ts', 'const x = eval(userInput)', 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-94')
    expect(hits[0].confidence).toBe('high')
  })

  it('C2: detects new Function(code)', () => {
    const result = scanCode('src/app.ts', 'const fn = new Function(code)', 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C3: detects exec with template literal', () => {
    const code = 'exec(`rm -rf ${path}`)'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'command-injection-template')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-78')
  })

  it('C4: detects child_process.exec(command)', () => {
    const code = 'child_process.exec(command)'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'command-injection-exec-direct')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C5: detects require("child_process")', () => {
    const code = "const cp = require('child_process')"
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'command-injection-require-cp')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
  })

  it('C6: detects command string concatenation', () => {
    const code = 'command = "convert " + inputFile'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'command-injection-string-concat')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C7: detects util.format for shell commands', () => {
    const code = "util.format('convert \"%s\"', pdfPath)"
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'command-injection-util-format')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C8: detects Python exec()', () => {
    const result = scanCode('src/app.py', 'exec(user_input)', 'python')
    const hits = issuesForRule(result.issues, 'python-exec')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-94')
  })

  it('C9: detects Python subprocess with shell=True', () => {
    const code = 'subprocess.run(cmd, shell=True)'
    const result = scanCode('src/app.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-subprocess-shell')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-78')
  })

  it('C10: detects Java Runtime.exec()', () => {
    const code = 'Runtime.getRuntime().exec(cmd)'
    const result = scanCode('src/App.java', code, 'java')
    const hits = issuesForRule(result.issues, 'java-runtime-exec')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C11: detects Ruby system with interpolation', () => {
    const code = 'system("rm #{filename}")'
    const result = scanCode('src/app.rb', code, 'ruby')
    const hits = issuesForRule(result.issues, 'ruby-system-exec')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C12: detects PHP eval()', () => {
    const code = 'eval($code)'
    const result = scanCode('src/app.php', code, 'php')
    const hits = issuesForRule(result.issues, 'php-eval')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C13: detects shell unquoted variable', () => {
    const code = 'rm $filename'
    const result = scanCode('src/deploy.sh', code, 'shell')
    const hits = issuesForRule(result.issues, 'shell-unquoted-var')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C14: eval in comment — suppressed by excludePattern', () => {
    const result = scanCode('src/app.ts', '// eval is dangerous, never use eval()', 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    expect(hits).toHaveLength(0)
  })

  it('C15: composite — child_process + exec(variable)', () => {
    const code = [
      "const cp = require('child_process')",
      'const command = buildCmd()',
      'cp.exec(command)',
    ].join('\n')
    const result = scanCode('src/runner.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'composite-cmd-injection-exec-var')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C16: composite — child_process + util.format()', () => {
    const code = [
      "const cp = require('child_process')",
      "const cmd = util.format('convert \"%s\"', file)",
      'cp.exec(cmd)',
    ].join('\n')
    const result = scanCode('src/runner.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'composite-cmd-injection-format')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C17: composite — child_process + string concat command', () => {
    const code = [
      "const cp = require('child_process')",
      'command = "ffmpeg " + inputPath',
      'cp.exec(command)',
    ].join('\n')
    const result = scanCode('src/runner.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'composite-cmd-injection-concat')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('C18: composite Python — os.system + f-string', () => {
    const code = [
      'import os',
      'os.system(f"rm {filename}")',
    ].join('\n')
    const result = scanCode('src/app.py', code, 'python')
    const hits = issuesForRule(result.issues, 'composite-python-os-cmd')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Category D: XSS / HTML Injection (~8 tests)
// ============================================================================

describe('Category D: XSS / HTML Injection', () => {
  it('D1: detects innerHTML assignment', () => {
    const result = scanCode('src/ui.ts', 'element.innerHTML = userContent', 'typescript')
    const hits = issuesForRule(result.issues, 'innerhtml-xss')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-79')
  })

  it('D2: detects dangerouslySetInnerHTML in TSX', () => {
    const code = 'return <div dangerouslySetInnerHTML={{ __html: content }} />'
    const result = scanCode('src/Component.tsx', code, 'typescript')
    const hits = issuesForRule(result.issues, 'innerhtml-xss')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('D3: detects innerHTML with variable', () => {
    const result = scanCode('src/ui.ts', 'el.innerHTML = data', 'typescript')
    const hits = issuesForRule(result.issues, 'innerhtml-xss')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('D4: FALSE POSITIVE — DOMPurify.sanitize not flagged', () => {
    const code = 'element.innerHTML = DOMPurify.sanitize(html)'
    const result = scanCode('src/ui.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'innerhtml-xss')
    expect(hits).toHaveLength(0)
  })

  it('D5: FALSE POSITIVE — sanitize() not flagged', () => {
    const code = 'element.innerHTML = sanitize(content)'
    const result = scanCode('src/ui.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'innerhtml-xss')
    expect(hits).toHaveLength(0)
  })

  it('D6: detects innerHTML with chained access', () => {
    const code = "document.getElementById('output').innerHTML = response"
    const result = scanCode('src/ui.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'innerhtml-xss')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('D7: textContent does NOT trigger', () => {
    const result = scanCode('src/ui.ts', 'element.textContent = value', 'typescript')
    const hits = issuesForRule(result.issues, 'innerhtml-xss')
    expect(hits).toHaveLength(0)
  })

  it('D8: innerHTML issues have fix and fixDescription', () => {
    const result = scanCode('src/ui.ts', 'element.innerHTML = data', 'typescript')
    const hits = issuesForRule(result.issues, 'innerhtml-xss')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].fix).toBeTruthy()
    expect(hits[0].fixDescription).toBeTruthy()
  })
})

// ============================================================================
// Category E: Deserialization (~8 tests)
// ============================================================================

describe('Category E: Deserialization', () => {
  it('E1: detects pickle.loads(data)', () => {
    const result = scanCode('src/app.py', 'pickle.loads(data)', 'python')
    const hits = issuesForRule(result.issues, 'python-pickle')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-502')
  })

  it('E2: detects pickle.load(file)', () => {
    const result = scanCode('src/app.py', 'pickle.load(file)', 'python')
    const hits = issuesForRule(result.issues, 'python-pickle')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('E3: detects pickle.Unpickler(file)', () => {
    const result = scanCode('src/app.py', 'obj = pickle.Unpickler(file)', 'python')
    const hits = issuesForRule(result.issues, 'python-pickle')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('E4: detects yaml.load without SafeLoader', () => {
    const result = scanCode('src/app.py', 'config = yaml.load(data)', 'python')
    const hits = issuesForRule(result.issues, 'python-yaml-load')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-502')
  })

  it('E5: FALSE POSITIVE — yaml.safe_load not flagged', () => {
    const result = scanCode('src/app.py', 'config = yaml.safe_load(data)', 'python')
    const hits = issuesForRule(result.issues, 'python-yaml-load')
    expect(hits).toHaveLength(0)
  })

  it('E6: detects Java ObjectInputStream.readObject()', () => {
    const code = 'Object obj = new ObjectInputStream(stream).readObject()'
    const result = scanCode('src/App.java', code, 'java')
    const hits = issuesForRule(result.issues, 'java-deserialization')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-502')
    expect(hits[0].confidence).toBe('high')
  })

  it('E7: FALSE POSITIVE — json.loads not flagged as deserialization', () => {
    const result = scanCode('src/app.py', 'data = json.loads(raw)', 'python')
    const pickleHits = issuesForRule(result.issues, 'python-pickle')
    const yamlHits = issuesForRule(result.issues, 'python-yaml-load')
    expect(pickleHits).toHaveLength(0)
    expect(yamlHits).toHaveLength(0)
  })

  it('E8: detects multiple deserialization vulns in one file', () => {
    const code = [
      'data = pickle.loads(raw)',
      'config = yaml.load(stream)',
    ].join('\n')
    const result = scanCode('src/app.py', code, 'python')
    const pickleHits = issuesForRule(result.issues, 'python-pickle')
    const yamlHits = issuesForRule(result.issues, 'python-yaml-load')
    expect(pickleHits.length).toBeGreaterThanOrEqual(1)
    expect(yamlHits.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Category F: Crypto Weaknesses (~8 tests)
// ============================================================================

describe('Category F: Crypto Weaknesses', () => {
  it('F1: detects crypto.createHash("md5")', () => {
    const result = scanCode('src/hash.ts', "crypto.createHash('md5')", 'typescript')
    const hits = issuesForRule(result.issues, 'weak-hash')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-328')
  })

  it('F2: detects crypto.createHash("sha1")', () => {
    const result = scanCode('src/hash.ts', "crypto.createHash('sha1')", 'typescript')
    const hits = issuesForRule(result.issues, 'weak-hash')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('F3: detects Java MessageDigest.getInstance with md5', () => {
    // The weak-hash pattern requires quotes around the algo name:
    // (?:createHash|hashlib|...) \s*\(?\s*['"](?:md5|sha1|sha-1)['"]
    // Python hashlib.md5() doesn't have quotes — GAP for method-based API.
    // But hashlib.new('md5') should match via the pattern prefix.
    // We test with the Digest style that does use quotes.
    const code = "MessageDigest.getInstance('md5')"
    const result = scanCode('src/Hash.java', code, 'java')
    const hits = issuesForRule(result.issues, 'weak-hash')
    // weak-hash has no fileFilter, so any file works
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('F4: FALSE POSITIVE — sha256 not flagged', () => {
    const result = scanCode('src/hash.ts', "crypto.createHash('sha256')", 'typescript')
    const hits = issuesForRule(result.issues, 'weak-hash')
    expect(hits).toHaveLength(0)
  })

  it('F5: detects Math.random() for token generation', () => {
    // Pattern: Math\.random\(\).*keyword — keyword must come AFTER Math.random()
    const code = 'const x = Math.random().toString(36) // token'
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'insecure-random')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-338')
  })

  it('F6: detects Math.random() for sessionId', () => {
    // Pattern: Math\.random\(\).*keyword — keyword must appear after Math.random()
    const code = 'generateSessionId(Math.random()) // session id generator'
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'insecure-random')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('F7: FALSE POSITIVE — Math.random() for non-security purpose', () => {
    const code = 'const width = Math.random() * 100'
    const result = scanCode('src/util.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'insecure-random')
    expect(hits).toHaveLength(0)
  })

  it('F8: crypto.randomUUID() does NOT trigger insecure-random', () => {
    const code = 'const id = crypto.randomUUID()'
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'insecure-random')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// Category G: Access Control (~12 tests)
// ============================================================================

describe('Category G: Access Control', () => {
  it('G1: detects open redirect via req.query', () => {
    const code = 'res.redirect(req.query.next)'
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'open-redirect')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-601')
  })

  it('G2: detects open redirect via window.location', () => {
    const code = 'window.location = params.url'
    const result = scanCode('src/redirect.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'open-redirect')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('G3: detects CORS wildcard', () => {
    const code = "res.setHeader('Access-Control-Allow-Origin', '*')"
    const result = scanCode('src/server.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'cors-wildcard')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-942')
  })

  it('G4: detects jwt.decode without verify', () => {
    const code = 'const payload = jwt.decode(token)'
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'jwt-no-verify')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-347')
  })

  it('G5: detects jwt.decode in Python', () => {
    const code = 'payload = jwt.decode(token)'
    const result = scanCode('src/auth.py', code, 'python')
    const hits = issuesForRule(result.issues, 'jwt-no-verify')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('G6: FALSE POSITIVE — jwt.verify not flagged', () => {
    const code = 'const payload = jwt.verify(token, secret)'
    const result = scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'jwt-no-verify')
    expect(hits).toHaveLength(0)
  })

  it('G7: detects path traversal with template literal', () => {
    const code = 'readFile(`./uploads/${req.params.filename}`)'
    const result = scanCode('src/files.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'path-traversal')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-22')
  })

  it('G8: FALSE POSITIVE — path.resolve with __dirname not flagged', () => {
    const code = "readFile(path.resolve(__dirname, 'config.json'))"
    const result = scanCode('src/config.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'path-traversal')
    expect(hits).toHaveLength(0)
  })

  it('G9: composite — req.params + readFile()', () => {
    const code = [
      'const filename = req.params.file',
      'const data = readFile(filename)',
    ].join('\n')
    const result = scanCode('src/api.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'composite-path-traversal-req')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('G10: composite — req.query + fetch() (SSRF)', () => {
    const code = [
      'const url = req.query.url',
      'const response = await fetch(url)',
    ].join('\n')
    const result = scanCode('src/proxy.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'composite-ssrf')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-918')
  })

  it('G11: composite — req.body + readFile with full mitigation → suppressed', () => {
    // Mitigation regex: /path\.resolve.*startsWith/ — needs both on same logical match
    // In joined content with \n, .* won't cross lines so both must be on one line
    const code = [
      'const file = req.body.path',
      'const safe = path.resolve(base, file); if (!safe.startsWith(base)) throw new Error("invalid")',
      'const data = readFile(safe)',
    ].join('\n')
    const result = scanCode('src/api.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'composite-path-traversal-req')
    expect(hits).toHaveLength(0)
  })

  it('G12: composite — no mitigation fires', () => {
    const code = [
      'const file = req.body.path',
      '// no validation at all',
      'const data = readFile(file)',
    ].join('\n')
    const result = scanCode('src/api.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'composite-path-traversal-req')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Category H: Multi-Language Real-World Patterns (~15 tests)
// ============================================================================

describe('Category H: Multi-Language Real-World Patterns', () => {
  it('H1: Python Django DEBUG = True', () => {
    const result = scanCode('src/settings.py', 'DEBUG = True', 'python')
    const hits = issuesForRule(result.issues, 'python-django-debug')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-215')
  })

  it('H2: FALSE POSITIVE — DEBUG = True in test_settings.py', () => {
    const result = scanCode('test_settings.py', 'DEBUG = True', 'python')
    const hits = issuesForRule(result.issues, 'python-django-debug')
    expect(hits).toHaveLength(0)
  })

  it('H3: Python assert for security check', () => {
    const code = 'assert user.is_admin, "Unauthorized"'
    const result = scanCode('src/auth.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-assert-security')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('H4: Go http.Get without timeout', () => {
    const code = 'resp, err := http.Get(url)'
    const result = scanCode('src/client.go', code, 'go')
    const hits = issuesForRule(result.issues, 'go-http-no-timeout')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-400')
  })

  it('H5: Go SQL string concatenation', () => {
    const code = 'rows, err := db.QueryContext(ctx, "SELECT * FROM users WHERE id = " + id)'
    const result = scanCode('src/db.go', code, 'go')
    const hits = issuesForRule(result.issues, 'go-sql-concat')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('H6: Rust unsafe block', () => {
    const code = 'unsafe { ptr::read(addr) }'
    const result = scanCode('src/lib.rs', code, 'rust')
    const hits = issuesForRule(result.issues, 'rust-unsafe')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-119')
  })

  it('H7: FALSE POSITIVE — Rust unsafe in comment', () => {
    const code = '// unsafe usage is bad'
    const result = scanCode('src/lib.rs', code, 'rust')
    const hits = issuesForRule(result.issues, 'rust-unsafe')
    expect(hits).toHaveLength(0)
  })

  it('H8: C gets() buffer overflow', () => {
    const code = 'gets(buffer);'
    const result = scanCode('src/main.c', code, 'c')
    const hits = issuesForRule(result.issues, 'c-gets')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-120')
  })

  it('H9: C strcpy without bounds', () => {
    const code = 'strcpy(dest, src);'
    const result = scanCode('src/main.c', code, 'c')
    const hits = issuesForRule(result.issues, 'c-strcpy')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-120')
  })

  it('H10: C sprintf fires same rule', () => {
    const code = 'sprintf(buf, src);'
    const result = scanCode('src/main.c', code, 'c')
    const hits = issuesForRule(result.issues, 'c-strcpy')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('H11: C format string vulnerability', () => {
    const code = 'printf(userInput);'
    const result = scanCode('src/main.c', code, 'c')
    const hits = issuesForRule(result.issues, 'c-format-string')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-134')
  })

  it('H12: FALSE POSITIVE — printf with literal format string', () => {
    const code = 'printf("%s", user_input);'
    const result = scanCode('src/main.c', code, 'c')
    const hits = issuesForRule(result.issues, 'c-format-string')
    expect(hits).toHaveLength(0)
  })

  it('H13: Ruby params.permit! mass assignment', () => {
    const code = 'User.create(params.permit!)'
    const result = scanCode('src/controller.rb', code, 'ruby')
    const hits = issuesForRule(result.issues, 'ruby-mass-assignment')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-915')
  })

  it('H14: PHP include with variable', () => {
    const code = 'include($page);'
    const result = scanCode('src/router.php', code, 'php')
    const hits = issuesForRule(result.issues, 'php-include-var')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-98')
  })

  it('H15: realistic Python file with subprocess + shell=True', () => {
    const code = [
      'import subprocess',
      'def run_cmd(user_input):',
      '    cmd = f"process {user_input}"',
      '    subprocess.call(cmd, shell=True)',
    ].join('\n')
    const result = scanCode('src/runner.py', code, 'python')
    const subprocHits = issuesForRule(result.issues, 'python-subprocess-shell')
    expect(subprocHits.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Category I: Quality & Structural (~12 tests)
// ============================================================================

describe('Category I: Quality & Structural', () => {
  it('I1: detects console.log in production file', () => {
    const result = scanCode('src/app.ts', 'console.log("debug")', 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('I2: FALSE POSITIVE — console.log in test file', () => {
    const result = scanCode('src/app.test.ts', 'console.log("debug")', 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits).toHaveLength(0)
  })

  it('I3: detects any type usage', () => {
    const result = scanCode('src/app.ts', 'const x: any = value', 'typescript')
    const hits = issuesForRule(result.issues, 'any-type')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-20')
  })

  it('I4: detects var usage', () => {
    const result = scanCode('src/app.ts', 'var x = 1', 'typescript')
    const hits = issuesForRule(result.issues, 'var-usage')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('I5: detects empty catch block', () => {
    const result = scanCode('src/app.ts', 'try { foo() } catch (e) {}', 'typescript')
    // After dedup, AST-detected ast-empty-catch wins over regex empty-catch
    const hits = result.issues.filter(i => i.ruleId === 'empty-catch' || i.ruleId === 'ast-empty-catch')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-390')
  })

  it('I6: detects eslint-disable inline', () => {
    // Pure comment lines get suppressed by context classifier for non-security.
    // Use inline code + comment pattern to bypass comment suppression.
    const result = scanCode('src/app.ts', 'doSomething() // eslint-disable-next-line', 'typescript')
    const hits = issuesForRule(result.issues, 'eslint-disable')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('I7: Python bare except', () => {
    const code = 'try:\n    pass\nexcept:'
    const result = scanCode('src/app.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-bare-except')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('I8: Python wildcard import', () => {
    const result = scanCode('src/app.py', 'from os import *', 'python')
    const hits = issuesForRule(result.issues, 'python-star-import')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('I9: Go discarded error', () => {
    // Pattern: [^,]\s*_\s*(?::)?=\s*\S+\( — needs a char before _
    const code = 'var _ = doSomething()'
    const result = scanCode('src/main.go', code, 'go')
    const hits = issuesForRule(result.issues, 'go-error-discard')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-252')
  })

  it('I10: Rust unwrap in production file', () => {
    const code = 'let val = result.unwrap()'
    const result = scanCode('src/lib.rs', code, 'rust')
    const hits = issuesForRule(result.issues, 'rust-unwrap')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('I11: TODO/FIXME comment', () => {
    // The pattern itself matches comment-prefixed TODOs, but context classifier
    // suppresses non-security rules on pure comment lines.
    // Use a line with code + trailing TODO comment to avoid suppression.
    const result = scanCode('src/app.ts', 'doSomething() // TODO: fix this later', 'typescript')
    const hits = issuesForRule(result.issues, 'todo-fixme')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('I12: hardcoded IP address (public IP)', () => {
    // Private IPs (192.168., 10., 172.xx., 127.0.0.1) are excluded
    const code = 'const host = "203.0.113.50:3000"'
    const result = scanCode('src/config.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-ip')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('I13: detects Go blank import without comment', () => {
    const code = '_ "database/sql"'
    const result = scanCode('src/main.go', code, 'go')
    const hits = issuesForRule(result.issues, 'go-unused-import-comment')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('I14: FALSE POSITIVE — Go blank import with comment is suppressed', () => {
    const code = '_ "database/sql" // for init()'
    const result = scanCode('src/main.go', code, 'go')
    const hits = issuesForRule(result.issues, 'go-unused-import-comment')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// Category J: Edge Cases & Obfuscation (~14 tests)
// ============================================================================

describe('Category J: Edge Cases & Obfuscation', () => {
  it('J1: multiple vulnerabilities in a single file', () => {
    const code = [
      'eval(input)',
      'element.innerHTML = data',
      'console.log("debug")',
    ].join('\n')
    const result = scanCode('src/bad.ts', code, 'typescript')
    const evalHits = issuesForRule(result.issues, 'eval-usage')
    const xssHits = issuesForRule(result.issues, 'innerhtml-xss')
    const consoleHits = issuesForRule(result.issues, 'console-log')
    expect(evalHits.length).toBeGreaterThanOrEqual(1)
    expect(xssHits.length).toBeGreaterThanOrEqual(1)
    expect(consoleHits.length).toBeGreaterThanOrEqual(1)
  })

  it('J2: same rule triggered multiple times', () => {
    const code = [
      'eval(a)',
      'eval(b)',
      'eval(c)',
    ].join('\n')
    const result = scanCode('src/bad.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    expect(hits.length).toBeGreaterThanOrEqual(3)
  })

  it('J3: rule overflow — MAX_PER_RULE caps at 15', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `eval(input_${i})`)
    const result = scanCode('src/bad.ts', lines.join('\n'), 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    expect(hits.length).toBeLessThanOrEqual(15)
    expect(result.ruleOverflow.size).toBeGreaterThanOrEqual(1)
  })

  it('J4: differential scan — only changed file issues', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index = indexFile(index, 'src/b.ts', 'eval(y)', 'typescript')
    index = indexFile(index, 'src/c.ts', 'const z = 1', 'typescript')

    const result = scanIssues(index, null, ['src/a.ts'])
    const filesWithIssues = new Set(result.issues.map(i => i.file))
    for (const file of filesWithIssues) {
      expect(file).toBe('src/a.ts')
    }
    expect(result.isPartialScan).toBe(true)
  })

  it('J5: differential scan — scannedFiles matches changed count', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index = indexFile(index, 'src/b.ts', 'eval(y)', 'typescript')
    index = indexFile(index, 'src/c.ts', 'const z = 1', 'typescript')

    const result = scanIssues(index, null, ['src/a.ts'])
    expect(result.scannedFiles).toBe(1)
  })

  it('J6: vendored path — eval in node_modules suppressed', () => {
    const result = scanCode('node_modules/pkg/index.js', 'eval(x)', 'javascript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    expect(hits).toHaveLength(0)
  })

  it('J7: generated file (.d.ts) suppresses non-security rules', () => {
    const result = scanCode('types/api.d.ts', 'console.log("auto-generated")', 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits).toHaveLength(0)
  })

  it('J8: eval-usage suppressed in test file (excludeFiles)', () => {
    const result = scanCode('__tests__/util.test.ts', 'const x = eval(userInput)', 'typescript')
    const hits = issuesForRule(result.issues, 'eval-usage')
    // eval-usage has explicit excludeFiles for test/spec/mock files
    expect(hits).toHaveLength(0)
  })

  it('J9: non-security rule in test file is suppressed', () => {
    const result = scanCode('utils.test.ts', 'console.log("debug")', 'typescript')
    const hits = issuesForRule(result.issues, 'console-log')
    expect(hits).toHaveLength(0)
  })

  it('J10: comment-embedded secret — security bypass behavior', () => {
    // Security-critical rules bypass comment suppression.
    // The line starting with // would be classified as comment,
    // but hardcoded-secret (critical + security) bypasses comment suppression.
    const code = '// api_key = "sk-real-a8f3K2m9X7v1B3q5w2E4"'
    const result = scanCode('src/app.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-secret')
    // Security-critical rules bypass comment suppression, so this fires
    // if entropy passes (the value has mixed case+digits → high entropy).
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('J11: type annotation context suppresses hardcoded-password', () => {
    // Type annotations suppress non-structural security matches
    // The hardcoded-password excludePattern excludes type/interface lines
    const code = 'interface UserConfig { password: string; host: string }'
    const result = scanCode('src/types.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-password')
    expect(hits).toHaveLength(0)
  })

  it('J12: multi-language index detects all languages', () => {
    const files = [
      { path: 'src/app.ts', code: 'const x = 1', lang: 'typescript' },
      { path: 'src/app.py', code: 'x = 1', lang: 'python' },
      { path: 'src/app.go', code: 'var x = 1', lang: 'go' },
      { path: 'src/lib.rs', code: 'let x = 1;', lang: 'rust' },
      { path: 'src/main.c', code: 'int x = 1;', lang: 'c' },
    ]
    const result = scanMultiFile(files)
    expect(result.languagesDetected).toContain('JavaScript/TypeScript')
    expect(result.languagesDetected).toContain('Python')
    expect(result.languagesDetected).toContain('Go')
    expect(result.languagesDetected).toContain('Rust')
    expect(result.languagesDetected).toContain('C/C++')
  })

  it('J13: empty file — no false positives', () => {
    const result = scanCode('src/empty.ts', '', 'typescript')
    expect(result.issues).toHaveLength(0)
  })

  it('J14: CSS/JSON files — no JS-specific rules fire', () => {
    const cssResult = scanCode('src/styles.css', '.eval { display: none }', 'css')
    const evalHits = issuesForRule(cssResult.issues, 'eval-usage')
    expect(evalHits).toHaveLength(0)

    const jsonResult = scanCode('config.json', '{ "eval": true }', 'json')
    const jsonEvalHits = issuesForRule(jsonResult.issues, 'eval-usage')
    expect(jsonEvalHits).toHaveLength(0)
  })
})

// ============================================================================
// Detection Rate Report
// ============================================================================

describe('Detection Rate Report', () => {
  it('computes and logs detection rate across all rule families', () => {
    const detectionTests: Array<{ name: string; detected: boolean; ruleId: string }> = []

    function check(name: string, ruleId: string, code: string, filename: string, lang?: string) {
      const result = scanCode(filename, code, lang)
      const hits = issuesForRule(result.issues, ruleId)
      detectionTests.push({ name, detected: hits.length > 0, ruleId })
    }

    // --- Category A: Secrets ---
    check('AWS key', 'hardcoded-aws-key', 'const k = "AKIAIOSFODNN7EXAMPLE1"', 'src/a.ts', 'typescript')
    check('API secret', 'hardcoded-secret', 'api_key = "sk-proj-a8f3k2m9x7v1b3q5w2e4"', 'src/a.ts', 'typescript')
    check('Password', 'hardcoded-password', 'password = "r3alP@ssw0rd!xyz9"', 'src/a.ts', 'typescript')
    check('Private key', 'private-key-inline', '-----BEGIN RSA PRIVATE KEY-----', 'src/a.ts', 'typescript')
    check('GitHub PAT', 'github-token', 'const t = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"', 'src/a.ts', 'typescript')

    // --- Category B: SQL ---
    check('SQL template', 'sql-injection', 'query(`SELECT * FROM users WHERE id = ${userId}`)', 'src/a.ts', 'typescript')
    check('SQL concat', 'sql-injection', 'query("SELECT * FROM users WHERE id = " + userId)', 'src/a.ts', 'typescript')
    check('Go SQL', 'go-sql-concat', 'db.QueryContext(ctx, fmt.Sprintf("SELECT * FROM users WHERE id = %s", id))', 'src/a.go', 'go')
    check('PHP SQL', 'php-sql-injection', '$conn->query("SELECT * FROM users WHERE id = $id")', 'src/a.php', 'php')

    // --- Category C: Command injection ---
    check('eval', 'eval-usage', 'eval(userInput)', 'src/a.ts', 'typescript')
    check('exec template', 'command-injection-template', 'exec(`rm -rf ${path}`)', 'src/a.ts', 'typescript')
    check('Python exec', 'python-exec', 'exec(user_input)', 'src/a.py', 'python')
    check('Python subprocess', 'python-subprocess-shell', 'subprocess.run(cmd, shell=True)', 'src/a.py', 'python')
    check('Java Runtime.exec', 'java-runtime-exec', 'Runtime.getRuntime().exec(cmd)', 'src/A.java', 'java')
    check('PHP eval', 'php-eval', 'eval($code)', 'src/a.php', 'php')
    check('Shell unquoted', 'shell-unquoted-var', 'rm $filename', 'src/a.sh', 'shell')

    // --- Category D: XSS ---
    check('innerHTML', 'innerhtml-xss', 'element.innerHTML = data', 'src/a.ts', 'typescript')
    check('dangerouslySetInnerHTML', 'innerhtml-xss', 'dangerouslySetInnerHTML={{ __html: content }}', 'src/a.tsx', 'typescript')

    // --- Category E: Deserialization ---
    check('pickle.loads', 'python-pickle', 'pickle.loads(data)', 'src/a.py', 'python')
    check('yaml.load', 'python-yaml-load', 'config = yaml.load(data)', 'src/a.py', 'python')
    check('Java deser', 'java-deserialization', 'Object obj = new ObjectInputStream(stream).readObject()', 'src/A.java', 'java')

    // --- Category F: Crypto ---
    check('MD5', 'weak-hash', "crypto.createHash('md5')", 'src/a.ts', 'typescript')
    check('Math.random token', 'insecure-random', 'const x = Math.random().toString(36) // token', 'src/a.ts', 'typescript')

    // --- Category G: Access Control ---
    check('Open redirect', 'open-redirect', 'res.redirect(req.query.next)', 'src/a.ts', 'typescript')
    check('CORS wildcard', 'cors-wildcard', "res.setHeader('Access-Control-Allow-Origin', '*')", 'src/a.ts', 'typescript')
    check('JWT decode', 'jwt-no-verify', 'const payload = jwt.decode(token)', 'src/a.ts', 'typescript')
    check('Path traversal', 'path-traversal', 'readFile(`./uploads/${req.params.filename}`)', 'src/a.ts', 'typescript')

    // --- Category H: Language-specific ---
    check('Django DEBUG', 'python-django-debug', 'DEBUG = True', 'src/settings.py', 'python')
    check('Rust unsafe', 'rust-unsafe', 'unsafe { ptr::read(addr) }', 'src/lib.rs', 'rust')
    check('C gets', 'c-gets', 'gets(buffer);', 'src/main.c', 'c')
    check('C strcpy', 'c-strcpy', 'strcpy(dest, src);', 'src/main.c', 'c')
    check('C format string', 'c-format-string', 'printf(userInput);', 'src/main.c', 'c')
    check('Ruby mass assign', 'ruby-mass-assignment', 'User.create(params.permit!)', 'src/a.rb', 'ruby')
    check('PHP include var', 'php-include-var', 'include($page);', 'src/a.php', 'php')

    // --- Category I: Quality ---
    check('console.log', 'console-log', 'console.log("debug")', 'src/a.ts', 'typescript')
    check('any type', 'any-type', 'const x: any = value', 'src/a.ts', 'typescript')
    check('var usage', 'var-usage', 'var x = 1', 'src/a.ts', 'typescript')
    check('empty catch', 'empty-catch', 'try { foo() } catch (e) {}', 'src/a.ts', 'typescript')
    check('TODO', 'todo-fixme', 'doSomething() // TODO: fix this later', 'src/a.ts', 'typescript')

    const total = detectionTests.length
    const detected = detectionTests.filter(t => t.detected).length
    const missed = detectionTests.filter(t => !t.detected)
    const rate = ((detected / total) * 100).toFixed(1)

    console.log('\n========================================')
    console.log(`DETECTION RATE: ${detected}/${total} (${rate}%)`)
    console.log('========================================')

    if (missed.length > 0) {
      console.log('\nMissed detections:')
      for (const m of missed) {
        console.log(`  - ${m.name} (${m.ruleId})`)
      }
    }

    // Expect at least 90% detection rate
    expect(detected / total).toBeGreaterThanOrEqual(0.9)
  })
})
