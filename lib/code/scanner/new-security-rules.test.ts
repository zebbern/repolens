/**
 * Tests for 29 newly added security regex rules across rules-security.ts
 * and rules-security-lang.ts.
 *
 * Pattern: scanCode(filename, code, lang) → assert ruleId, severity, cwe.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/parsers/tree-sitter', () => import('@/lib/code/scanner/__tests__/tree-sitter-mock'))

import { scan } from '@/lib/code/scanner/__tests__/scan-test-helpers'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import type { CodeIssue } from '@/lib/code/scanner/types'

// ============================================================================
// Helpers
// ============================================================================

async function scanCode(filename: string, code: string, lang?: string) {
  let index = createEmptyIndex()
  index = indexFile(index, filename, code, lang)
  return scan(index, null)
}

function issuesForRule(issues: CodeIssue[], ruleId: string) {
  return issues.filter(i => i.ruleId === ruleId)
}

// ============================================================================
// TLS / Certificate Verification
// ============================================================================

describe('TLS / Certificate Verification Rules', () => {
  it('detects rejectUnauthorized: false', async () => {
    const code = `const agent = new https.Agent({ rejectUnauthorized: false });`
    const result = await scanCode('src/http-client.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'tls-reject-unauthorized-false')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-295')
  })

  it('does not flag rejectUnauthorized: false when line contains test/mock context', async () => {
    const code = `// test setup: const agent = new https.Agent({ rejectUnauthorized: false });`
    const result = await scanCode('src/http-client.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'tls-reject-unauthorized-false')
    expect(hits).toHaveLength(0)
  })

  it('detects NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    const code = `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';`
    const result = await scanCode('src/setup.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'tls-env-disable')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-295')
  })

  it('does not flag NODE_TLS_REJECT_UNAUTHORIZED=0 with test context in line', async () => {
    const code = `// test fixture: process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';`
    const result = await scanCode('src/setup.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'tls-env-disable')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// Hardcoded Crypto Parameters
// ============================================================================

describe('Hardcoded Crypto Parameters', () => {
  it('detects hardcoded IV in createCipheriv', async () => {
    const code = `const cipher = crypto.createCipheriv('aes-256-cbc', key, 'abcdef1234567890');`
    const result = await scanCode('src/encrypt.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-iv')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-329')
  })

  it('does not flag createCipheriv with randomBytes IV', async () => {
    const code = `const cipher = crypto.createCipheriv('aes-256-cbc', key, crypto.randomBytes(16));`
    const result = await scanCode('src/encrypt.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-iv')
    expect(hits).toHaveLength(0)
  })

  it('detects hardcoded salt in pbkdf2', async () => {
    const code = `crypto.pbkdf2(password, 'static-salt', 100000, 32, 'sha256', cb);`
    const result = await scanCode('src/auth.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-salt')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-760')
  })

  it('detects static crypto key in createCipheriv', async () => {
    const code = `const cipher = crypto.createCipheriv('aes-256-cbc', 'my-secret-key-1234', iv);`
    const result = await scanCode('src/encrypt.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'static-crypto-key')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-321')
  })

  it('does not flag crypto key from env variable', async () => {
    const code = `const cipher = crypto.createCipheriv('aes-256-cbc', process.env.CRYPTO_KEY, iv);`
    const result = await scanCode('src/encrypt.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'static-crypto-key')
    expect(hits).toHaveLength(0)
  })

  it('detects hardcoded HMAC key', async () => {
    const code = `const hmac = crypto.createHmac('sha256', 'my-secret-key');`
    const result = await scanCode('src/signing.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'hardcoded-hmac-key')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-321')
  })
})

// ============================================================================
// Node.js Sandbox Escapes
// ============================================================================

describe('Node.js Sandbox Escapes', () => {
  it('detects vm.runInNewContext()', async () => {
    const code = `vm.runInNewContext('this.constructor.constructor("return process")()', sandbox);`
    const result = await scanCode('src/sandbox.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'vm-code-execution')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-94')
  })

  it('detects vm.runInThisContext()', async () => {
    const code = `const result = vm.runInThisContext(userScript);`
    const result = await scanCode('src/sandbox.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'vm-code-execution')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects vm.compileFunction()', async () => {
    const code = `const fn = vm.compileFunction(code, ['arg1']);`
    const result = await scanCode('src/sandbox.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'vm-code-execution')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects vm2 require', async () => {
    const code = `const { VM } = require('vm2');`
    const result = await scanCode('src/sandbox.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'vm2-deprecated')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-94')
  })

  it('detects vm2 import', async () => {
    const code = `import { VM } from 'vm2';`
    const result = await scanCode('src/sandbox.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'vm2-deprecated')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects Worker with eval: true', async () => {
    const code = `const worker = new Worker(script, { eval: true });`
    const result = await scanCode('src/workers.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'worker-eval')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-94')
  })
})

// ============================================================================
// Object Injection
// ============================================================================

describe('Object Injection', () => {
  it('detects bracket notation with req.body', async () => {
    const code = `const value = config[req.body.key];`
    const result = await scanCode('src/handler.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'object-injection-bracket')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-1321')
  })

  it('detects bracket notation with req.query', async () => {
    const code = `const value = settings[req.query.name];`
    const result = await scanCode('src/handler.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'object-injection-bracket')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag bracket notation with allowlist', async () => {
    const code = `const allowedKeys = ['a', 'b']; const value = config[req.body.key]; // allowlist checked above`
    const result = await scanCode('src/handler.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'object-injection-bracket')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// Insecure Deserialization
// ============================================================================

describe('Insecure Deserialization (JS)', () => {
  it('detects node-serialize require', async () => {
    const code = `const serialize = require('node-serialize');`
    const result = await scanCode('src/data.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'node-serialize-unserialize')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-502')
  })

  it('detects .unserialize() call', async () => {
    const code = `const obj = payload.unserialize(data);`
    const result = await scanCode('src/data.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'node-serialize-unserialize')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects serialize-javascript usage', async () => {
    const code = `import serialize from 'serialize-javascript';`
    const result = await scanCode('src/render.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'serialize-javascript-exec')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-502')
  })
})

// ============================================================================
// Secret Detection — Additional Providers
// ============================================================================

describe('Secret Detection — Additional Providers', () => {
  it('detects Twilio API key (SK prefix)', async () => {
    // Constructed at runtime to avoid GitHub push protection false positive
    const fakeKey = 'SK' + '1a2b3c4d5e6f7a8b' + '9c0d1e2f3a4b5c6d'
    const code = `const twilioKey = "${fakeKey}";`
    const result = await scanCode('src/sms.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'twilio-token')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-798')
  })

  it('detects SendGrid API key (SG. prefix)', async () => {
    // Constructed at runtime to avoid GitHub push protection false positive
    const fakeKey = 'SG.' + 'abcdefghijklmnopqrstuA' + '.' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq'
    const code = `const sgKey = "${fakeKey}";`
    const result = await scanCode('src/email.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'sendgrid-key')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-798')
  })

  it('detects npm token (npm_ prefix)', async () => {
    const code = `const npmToken = "npm_abcdefghijklmnopqrstuvwxyz0123456789";`
    const result = await scanCode('src/publish.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'npm-token')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-798')
  })

  it('detects PyPI token (pypi- prefix)', async () => {
    // pypi tokens are 100+ chars after the prefix
    const longToken = 'A'.repeat(110)
    const code = `token = "pypi-${longToken}"`
    const result = await scanCode('src/release.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'pypi-token')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-798')
  })

  it('detects Azure connection string', async () => {
    const code = `const connStr = "DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH==;EndpointSuffix=core.windows.net";`
    const result = await scanCode('src/storage.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'azure-connection-string')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
    expect(hits[0].cwe).toBe('CWE-798')
  })

  it('detects Heroku API key', async () => {
    const code = `const herokuKey = "heroku-api-key: a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";`
    const result = await scanCode('src/deploy.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'heroku-api-key')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-798')
  })

  it('detects Mailgun key (key- prefix)', async () => {
    const code = `const mailgunKey = "key-abcdef1234567890abcdef1234567890";`
    const result = await scanCode('src/mailer.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'mailgun-key')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-798')
  })
})

// ============================================================================
// CSP Misconfigurations
// ============================================================================

describe('CSP Misconfigurations', () => {
  it('detects CSP with unsafe-inline', async () => {
    const code = `res.setHeader('Content-Security-Policy', "script-src 'unsafe-inline'");`
    const result = await scanCode('src/middleware.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'csp-unsafe-inline')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-693')
  })

  it('detects CSP with unsafe-eval', async () => {
    const code = `res.setHeader('Content-Security-Policy', "script-src 'unsafe-eval'");`
    const result = await scanCode('src/middleware.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'csp-unsafe-eval')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-693')
  })

  it('detects CSP with wildcard source', async () => {
    const code = `res.setHeader('Content-Security-Policy', "default-src *");`
    const result = await scanCode('src/middleware.ts', code, 'typescript')
    const hits = issuesForRule(result.issues, 'csp-wildcard-source')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-693')
  })
})

// ============================================================================
// Python Security Rules
// ============================================================================

describe('Python Security Rules', () => {
  it('detects tempfile.mktemp()', async () => {
    const code = `import tempfile\nfname = tempfile.mktemp()`
    const result = await scanCode('src/utils.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-tempfile-mktemp')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-377')
  })

  it('detects verify=False (SSL disabled)', async () => {
    const code = `requests.get('https://api.example.com', verify=False)`
    const result = await scanCode('src/client.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-ssl-no-verify')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-295')
  })

  it('detects CERT_NONE (SSL disabled)', async () => {
    const code = `ctx = ssl.create_default_context()\nctx.check_hostname = False\nctx.verify_mode = ssl.CERT_NONE`
    const result = await scanCode('src/client.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-ssl-no-verify')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects marshal.load()', async () => {
    const code = `import marshal\nobj = marshal.load(f)`
    const result = await scanCode('src/loader.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-marshal-load')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-502')
  })

  it('detects marshal.loads()', async () => {
    const code = `obj = marshal.loads(data)`
    const result = await scanCode('src/loader.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-marshal-load')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects shelve.open()', async () => {
    const code = `import shelve\ndb = shelve.open('mydata')`
    const result = await scanCode('src/storage.py', code, 'python')
    const hits = issuesForRule(result.issues, 'python-shelve-open')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].cwe).toBe('CWE-502')
  })
})

// ============================================================================
// PHP Deserialization
// ============================================================================

describe('PHP Deserialization', () => {
  it('detects unserialize()', async () => {
    const code = `$obj = unserialize($data);`
    const result = await scanCode('src/handler.php', code, 'php')
    const hits = issuesForRule(result.issues, 'php-unserialize')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-502')
  })

  it('does not flag unserialize with allowed_classes: false', async () => {
    const code = `$obj = unserialize($data, ['allowed_classes' => false]);`
    const result = await scanCode('src/handler.php', code, 'php')
    const hits = issuesForRule(result.issues, 'php-unserialize')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// Ruby Deserialization
// ============================================================================

describe('Ruby Deserialization', () => {
  it('detects Marshal.load()', async () => {
    const code = `obj = Marshal.load(data)`
    const result = await scanCode('src/loader.rb', code, 'ruby')
    const hits = issuesForRule(result.issues, 'ruby-marshal-load')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-502')
  })

  it('detects Marshal.restore()', async () => {
    const code = `obj = Marshal.restore(file.read)`
    const result = await scanCode('src/loader.rb', code, 'ruby')
    const hits = issuesForRule(result.issues, 'ruby-marshal-load')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// .NET BinaryFormatter
// ============================================================================

describe('.NET BinaryFormatter', () => {
  it('detects BinaryFormatter.Deserialize()', async () => {
    // Pattern requires BinaryFormatter and Deserialize/Serialize on the SAME line
    const code = `var obj = new BinaryFormatter().Deserialize(stream);`
    const result = await scanCode('src/DataHandler.cs', code, 'csharp')
    const hits = issuesForRule(result.issues, 'dotnet-binary-formatter')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].cwe).toBe('CWE-502')
  })
})
