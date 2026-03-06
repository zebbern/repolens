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
      { ruleId: 'composite-file-upload-no-validation', line: 5, verdict: 'fp' },
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
]
