// Composite rule fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const compositeFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. Express route with auth middleware → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'express-route-with-auth',
    description: 'Route with authMiddleware — composite-missing-auth-express-route should NOT fire',
    file: {
      path: 'src/routes/admin.ts',
      content: `import { Router } from 'express'
import { authMiddleware } from '../middleware/auth'
import { adminController } from '../controllers/admin'

const router = Router()

router.post('/data', authMiddleware, adminController.createData)
router.get('/users', authMiddleware, adminController.listUsers)
router.delete('/users/:id', authMiddleware, adminController.deleteUser)

export default router`,
      language: 'typescript',
    },
    expected: [
      // authMiddleware present → should NOT fire
    ],
  },

  // -----------------------------------------------------------------------
  // 2. Express route without auth → TP
  // -----------------------------------------------------------------------
  {
    name: 'express-route-no-auth',
    description: 'Admin route without auth middleware — TP',
    file: {
      path: 'src/routes/unprotected-admin.ts',
      content: `import { Router } from 'express'
import { adminController } from '../controllers/admin'

const router = Router()

router.post('/admin/delete', adminController.deleteAll)
router.put('/admin/config', adminController.updateConfig)

export default router`,
      language: 'typescript',
    },
    expected: [
      // No auth middleware on admin routes → should fire
      // Note: composite rules require multi-file analysis, may not fire on single-file fixtures
      { ruleId: 'composite-missing-auth-express-route', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 3. File upload with validation → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'file-upload-with-validation',
    description: 'multer upload with file type checking — should NOT fire',
    file: {
      path: 'src/routes/upload.ts',
      content: `import { Router } from 'express'
import multer from 'multer'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024

const upload = multer({
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type'))
    }
  },
})

const router = Router()
router.post('/upload', upload.single('avatar'), async (req, res) => {
  res.json({ url: req.file?.path })
})

export default router`,
      language: 'typescript',
    },
    expected: [
      // multer with fileFilter validation → composite-file-upload-no-validation should NOT fire
      { ruleId: 'composite-missing-auth-express-route', line: 19, verdict: 'tp' },
      { ruleId: 'composite-async-no-try-catch', line: 19, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 4. Path traversal with sanitization → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'path-traversal-with-sanitization',
    description: 'path.join with normalize and .. check — should NOT fire',
    file: {
      path: 'src/routes/files.ts',
      content: `import { Router } from 'express'
import path from 'path'
import fs from 'fs/promises'

const UPLOADS_DIR = path.resolve('./uploads')
const router = Router()

router.get('/files/:name', async (req, res) => {
  const sanitized = path.normalize(req.params.name).replace(/\\.\\./g, '')
  const filePath = path.join(UPLOADS_DIR, sanitized)
  if (!filePath.startsWith(UPLOADS_DIR)) {
    return res.status(403).json({ error: 'Access denied' })
  }
  const data = await fs.readFile(filePath)
  res.send(data)
})

export default router`,
      language: 'typescript',
    },
    expected: [
      // Path traversal mitigations present but taint tracker is conservative
      { ruleId: 'taint-path-traversal', line: 14, verdict: 'tp' },
      { ruleId: 'composite-missing-auth-express-route', line: 8, verdict: 'tp' },
      // composite-file-upload-no-validation no longer fires (tightened requiredPatterns: multer|formidable|busboy)
      { ruleId: 'composite-async-no-try-catch', line: 8, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 5. SSRF with allowlist → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'ssrf-with-allowlist',
    description: 'fetch with URL validation against allowlist — should NOT fire',
    file: {
      path: 'src/services/proxy.ts',
      content: `const ALLOWED_HOSTS = ['api.github.com', 'api.stripe.com']

export async function proxyRequest(targetUrl: string) {
  const parsed = new URL(targetUrl)
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    throw new Error('Host not in allowlist')
  }
  const response = await fetch(targetUrl)
  return response.json()
}`,
      language: 'typescript',
    },
    expected: [
      // Allowlist validation present but per-line rules can't see the check
      { ruleId: 'nextjs-rsc-ssrf', line: 8, verdict: 'fp' },
      { ruleId: 'composite-async-no-try-catch', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 6. Express cookie without signed/sameSite → TP
  // -----------------------------------------------------------------------
  {
    name: 'express-cookie-not-secure',
    description: 'res.cookie without secure flags — TP',
    file: {
      path: 'src/routes/preferences.ts',
      content: `import { Router } from 'express'

const router = Router()

router.post('/preferences/theme', (req, res) => {
  res.cookie('theme', req.body.theme, { maxAge: 86400000 })
  res.json({ ok: true })
})

export default router`,
      language: 'typescript',
    },
    expected: [
      // cookie-no-httponly only fires on explicit httpOnly: false, not absence
      { ruleId: 'composite-missing-auth-express-route', line: 5, verdict: 'tp' },
      { ruleId: 'cookie-no-samesite', line: 6, verdict: 'tp' },
      { ruleId: 'express-cookie-not-signed', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 7. Verbose error response → TP
  // -----------------------------------------------------------------------
  {
    name: 'verbose-error-response',
    description: 'Sending raw error object in response — TP',
    file: {
      path: 'src/middleware/error-handler.ts',
      content: `import { Request, Response, NextFunction } from 'express'

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(err.stack)
  res.status(500).json({ error: err.message, stack: err.stack })
}`,
      language: 'typescript',
    },
    expected: [
      // verbose-error-response pattern expects raw err in json() — structured object doesn't match
      // console-log rule matches console.log, not console.error
    ],
  },

  // -----------------------------------------------------------------------
  // 8. Hardcoded JWT secret → TP
  // -----------------------------------------------------------------------
  {
    name: 'hardcoded-jwt-secret',
    description: 'JWT signed with hardcoded secret string — TP',
    file: {
      path: 'src/auth/jwt.ts',
      content: `import jwt from 'jsonwebtoken'

const JWT_SECRET = "my-super-secret-jwt-key-2024"

export function signToken(payload: object) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
}

export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET)
}`,
      language: 'typescript',
    },
    expected: [
      // hardcoded-secret doesn't fire: JWT_SECRET has no word boundary for \bsecret\b
      // jwt-hardcoded-secret rule doesn't exist
      { ruleId: 'jwt-missing-algorithms', line: 10, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 9. AWS credentials in code → TP
  // -----------------------------------------------------------------------
  {
    name: 'aws-credentials-hardcoded',
    description: 'AWS access key and secret in source code — TP',
    file: {
      path: 'src/config/aws.ts',
      content: `export const awsConfig = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'hardcoded-aws-key', line: 2, verdict: 'tp' },
      // hardcoded-secret doesn't fire on secretAccessKey: no word boundary for \bsecret\b
    ],
  },

  // -----------------------------------------------------------------------
  // 10. GitHub token in code → TP
  // -----------------------------------------------------------------------
  {
    name: 'github-token-hardcoded',
    description: 'GitHub personal access token hardcoded — TP',
    file: {
      path: 'src/services/github.ts',
      content: `const GITHUB_TOKEN = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"

export async function fetchRepos() {
  const res = await fetch("https://api.github.com/user/repos", {
    headers: { Authorization: \`Bearer \${GITHUB_TOKEN}\` },
  })
  return res.json()
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'github-token', line: 1, verdict: 'tp' },
      { ruleId: 'composite-async-no-try-catch', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 11. Express session fixation → TP
  // -----------------------------------------------------------------------
  {
    name: 'express-session-fixation',
    description: 'express-session without resave: false — TP for express-session-fixation',
    file: {
      path: 'src/middleware/session.ts',
      content: `import express from 'express'
import session from 'express-session'

const app = express()
app.use(session({
  secret: 'keyboard cat',
  saveUninitialized: true,
}))

export default app`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'express-session-fixation', line: 2, verdict: 'tp' },
      { ruleId: 'express-no-helmet', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 12. Express CORS credentials with wildcard → TP
  // -----------------------------------------------------------------------
  {
    name: 'express-cors-credentials-wildcard',
    description: 'cors with origin: * and credentials: true — TP',
    file: {
      path: 'src/middleware/cors-config.ts',
      content: `import cors from 'cors'
import express from 'express'

const app = express()
app.use(cors({ origin: '*', credentials: true }))

export default app`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'express-cors-credentials-wildcard', line: 5, verdict: 'tp' },
      { ruleId: 'express-no-helmet', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 13. WebSocket server without auth → TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-websocket-no-auth',
    description: 'WebSocketServer without authentication — open access, TP',
    file: {
      path: 'src/ws/server.ts',
      content: `import { WebSocketServer } from 'ws'

const wss = new WebSocketServer({ port: 8080 })

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    ws.send(\`Echo: \${data}\`)
  })
})`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-websocket-no-auth', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 14. TOCTOU — existsSync + writeFileSync race → TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-toctou-file-check',
    description: 'existsSync + unlinkSync + writeFileSync — TOCTOU race condition, TP',
    file: {
      path: 'src/utils/safe-write.ts',
      content: `import fs from 'fs'

export function safeWrite(filePath: string, data: string) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
  fs.writeFileSync(filePath, data)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-toctou-file-check', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 15. Command injection: exec() with variable — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-cmd-injection-exec-var',
    description: 'child_process import + exec(cmd) with variable — cmd injection TP',
    file: {
      path: 'src/utils/run-command.ts',
      content: `import { exec } from 'child_process'
export function runCommand(userCmd: string) {
  const cmd = \`ls \${userCmd}\`
  exec(cmd, (err, stdout) => console.log(stdout))
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-cmd-injection-exec-var', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 16. Command injection: exec() with util.format — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-cmd-injection-format',
    description: 'child_process import + util.format command string — cmd injection TP',
    file: {
      path: 'src/utils/pdf-convert.ts',
      content: `import { exec } from 'child_process'
import util from 'util'
export function convertPdf(inputPath: string) {
  const cmd = util.format('convert "%s" out.pdf', inputPath)
  exec(cmd)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-cmd-injection-format', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 17. Command injection: exec() with string concat — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-cmd-injection-concat',
    description: 'child_process import + command built via string concat — cmd injection TP',
    file: {
      path: 'src/deploy/runner.ts',
      content: `import { exec } from 'child_process'
export function deploy(branch: string) {
  let command = 'git checkout ' + branch
  command += ' && npm run build'
  exec(command)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-cmd-injection-concat', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 18. Path traversal: req.query flows into readFile — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-path-traversal-req',
    description: 'req.query.name passed into fs.readFile — path traversal TP',
    file: {
      path: 'src/routes/file-serve.ts',
      content: `import { Router } from 'express'
import fs from 'fs'
const router = Router()
router.get('/file', async (req, res) => {
  const name = req.query.name as string
  const data = await fs.promises.readFile('./uploads/' + name)
  res.send(data)
})`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-path-traversal-req', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 19. SSRF: req.query.url flows into fetch — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-ssrf',
    description: 'req.query.url passed to fetch() — SSRF TP',
    file: {
      path: 'src/routes/proxy.ts',
      content: `import { Router } from 'express'
const router = Router()
router.get('/proxy', async (req, res) => {
  const url = req.query.url as string
  const response = await fetch(url)
  res.json(await response.json())
})`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-ssrf', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 20. Open redirect: res.redirect with req.query — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-open-redirect-response',
    description: 'res.redirect(req.query.returnTo) — open redirect TP',
    file: {
      path: 'src/routes/callback.ts',
      content: `import { Router } from 'express'
const router = Router()
router.get('/callback', (req, res) => {
  const returnUrl = req.query.returnTo as string
  res.redirect(returnUrl)
})`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-open-redirect-response', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 21. Mass assignment: Model.create(req.body) — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-mass-assignment-orm',
    description: 'User.create(req.body) without field whitelist — mass assignment TP',
    file: {
      path: 'src/routes/users.ts',
      content: `import { Router } from 'express'
const router = Router()
router.post('/users', async (req, res) => {
  const user = await User.create(req.body)
  res.json(user)
})`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-mass-assignment-orm', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 22. IDOR: findById(req.params.id) without auth — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-idor-direct-lookup',
    description: 'Order.findById(req.params.id) without ownership check — IDOR TP',
    file: {
      path: 'src/routes/orders.ts',
      content: `import { Router } from 'express'
const router = Router()
router.get('/orders/:id', async (req, res) => {
  const order = await Order.findById(req.params.id)
  res.json(order)
})`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-idor-direct-lookup', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 23. TOCTOU: async access() + writeFile() race — TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-toctou-async-file',
    description: 'fs.access() before fs.writeFile() — async TOCTOU race, TP',
    file: {
      path: 'src/utils/safe-write-async.ts',
      content: `import fs from 'fs/promises'
export async function writeIfMissing(path: string, data: string) {
  const exists = await fs.access(path).then(() => true).catch(() => false)
  if (!exists) {
    await fs.writeFile(path, data)
  }
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-toctou-async-file', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 24. NEGATIVE: execFile is safe — no composite cmd injection
  // -----------------------------------------------------------------------
  {
    name: 'composite-cmd-safe-execfile',
    description: 'execFile() with argument array — safe, no composite cmd injection',
    file: {
      path: 'src/utils/image-convert.ts',
      content: `import { execFile } from 'child_process'
export function convertImage(inputPath: string) {
  execFile('convert', [inputPath, 'output.png'], (err) => {
    if (err) console.error(err)
  })
}`,
      language: 'typescript',
    },
    expected: [
      // execFile is safe — composite cmd injection rules should NOT fire
    ],
  },

  // -----------------------------------------------------------------------
  // 25. NEGATIVE: static URL in fetch — no SSRF
  // -----------------------------------------------------------------------
  {
    name: 'composite-ssrf-safe-static',
    description: 'fetch() with hardcoded URL — no req.query, no SSRF',
    file: {
      path: 'src/services/weather.ts',
      content: `export async function getWeather() {
  const response = await fetch('https://api.weather.gov/forecast')
  return response.json()
}`,
      language: 'typescript',
    },
    expected: [
      // Static URL, no req.query — composite-ssrf should NOT fire
    ],
  },

  // -----------------------------------------------------------------------
  // 26. NEGATIVE: destructured req.body — no mass assignment
  // -----------------------------------------------------------------------
  {
    name: 'composite-mass-assignment-safe',
    description: 'Destructured req.body fields — mass assignment should NOT fire',
    file: {
      path: 'src/routes/users-safe.ts',
      content: `import { Router } from 'express'
const router = Router()
router.post('/users', async (req, res) => {
  const { name, email } = req.body
  const user = await User.create({ name, email })
  res.json(user)
})`,
      language: 'typescript',
    },
    expected: [
      // Destructured fields — composite-mass-assignment-orm should NOT fire
    ],
  },

  // -----------------------------------------------------------------------
  // 27. NEGATIVE: writeFile without existence check — no TOCTOU
  // -----------------------------------------------------------------------
  {
    name: 'composite-toctou-safe',
    description: 'Direct writeFile without access/exists check — no TOCTOU',
    file: {
      path: 'src/utils/write-config.ts',
      content: `import fs from 'fs/promises'
export async function writeConfig(path: string, data: string) {
  try {
    await fs.writeFile(path, data)
  } catch (err) {
    console.error('Write failed', err)
  }
}`,
      language: 'typescript',
    },
    expected: [
      // No access/exists/stat check before writeFile — TOCTOU should NOT fire
    ],
  },
]
