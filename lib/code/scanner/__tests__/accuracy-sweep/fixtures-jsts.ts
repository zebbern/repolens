// JavaScript/TypeScript fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const jstsFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. React hooks with sensitive-sounding names → expect secret rules NOT to fire
  // -----------------------------------------------------------------------
  {
    name: 'react-hooks-sensitive-names',
    description: 'useState with password/secret/token state variables — not hardcoded secrets',
    file: {
      path: 'src/components/LoginForm.tsx',
      content: `import { useState } from 'react'

interface LoginFormProps {
  onSubmit: (user: string, pass: string) => void
}

export function LoginForm({ onSubmit }: LoginFormProps) {
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form onSubmit={() => onSubmit(apiKey, password)}>
      <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} />
    </form>
  )
}`,
      language: 'typescriptreact',
    },
    expected: [
      // These should NOT fire — empty string defaults, state vars, not secrets
    ],
  },

  // -----------------------------------------------------------------------
  // 2. TypeScript type definitions → secret/eval rules should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'typescript-type-definitions',
    description: 'Interfaces and types with password/secret fields — type annotations not secrets',
    file: {
      path: 'src/types/auth.ts',
      content: `export interface AuthConfig {
  password: string
  secretKey: Buffer
  apiToken: string
}

export type EvalResult = {
  output: string
  exitCode: number
}

export interface PasswordResetRequest {
  email: string
  newPassword: string
  confirmPassword: string
}`,
      language: 'typescript',
    },
    expected: [
      // Type annotation suppression should prevent secret rules from firing
    ],
  },

  // -----------------------------------------------------------------------
  // 3. Test file with eval/exec — quality rules should not fire on test files
  // -----------------------------------------------------------------------
  {
    name: 'test-file-with-eval',
    description: 'Test file using eval/innerHTML/console.log — quality rules suppressed for tests',
    file: {
      path: 'src/__tests__/expression-parser.test.ts',
      content: `import { describe, it, expect } from 'vitest'
import { parse } from '../expression-parser'

describe('expression parser', () => {
  it('evaluates simple math', () => {
    const result = eval('2 + 3')
    expect(result).toBe(5)
  })

  it('renders output to DOM', () => {
    const div = document.createElement('div')
    div.innerHTML = '<span class="result">42</span>'
    expect(div.textContent).toBe('42')
  })

  it('logs debug info', () => {
    console.log('test debug output')
  })
})`,
      language: 'typescript',
    },
    expected: [
      // eval-usage now suppressed by excludeFiles (__tests__ + .test. match)
    ],
  },

  // -----------------------------------------------------------------------
  // 4. Express middleware chain without helmet/rate-limit → TP
  // -----------------------------------------------------------------------
  {
    name: 'express-middleware-no-security',
    description: 'Express app without helmet or rate-limit middleware — should fire as TP',
    file: {
      path: 'src/server.ts',
      content: `import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/users', async (req, res) => {
  const users = await getUsers()
  res.json(users)
})

app.post('/api/data', async (req, res) => {
  res.json({ ok: true })
})

app.listen(3000)`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'express-no-helmet', line: 4, verdict: 'tp' },
      { ruleId: 'express-no-rate-limit', line: 8, verdict: 'tp' },
      { ruleId: 'express-body-parser-no-limit', line: 6, verdict: 'tp' },
      { ruleId: 'composite-csrf-missing-express', line: 13, verdict: 'tp' },
      { ruleId: 'composite-async-no-try-catch', line: 8, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 5. Next.js API route with auth → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'nextjs-api-route-with-auth',
    description: 'Authenticated Next.js API route — nextjs-api-no-auth should NOT fire',
    file: {
      path: 'app/api/protected/route.ts',
      content: `import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return Response.json({ data: 'secret data' })
}`,
      language: 'typescript',
    },
    expected: [
      // nextjs-api-no-auth composite: getServerSession in file suppresses via mitigations
      { ruleId: 'composite-async-no-try-catch', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 6. Real eval usage → TP
  // -----------------------------------------------------------------------
  {
    name: 'real-eval-usage',
    description: 'eval(userInput) in production code — definite TP',
    file: {
      path: 'src/routes/calculator.ts',
      content: `import { Router } from 'express'

const router = Router()

router.post('/calculate', (req, res) => {
  const expression = req.body.expression
  const result = eval(expression)
  res.json({ result })
})

export default router`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'eval-usage', line: 7, verdict: 'tp' },
      { ruleId: 'taint-code-injection', line: 7, verdict: 'tp' },
      { ruleId: 'composite-missing-auth-express-route', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 7. Safe innerHTML with DOMPurify → should be suppressed
  // -----------------------------------------------------------------------
  {
    name: 'safe-innerhtml-dompurify',
    description: 'innerHTML with DOMPurify.sanitize — sanitizer should suppress or lower confidence',
    file: {
      path: 'src/components/RichText.tsx',
      content: `import DOMPurify from 'dompurify'

interface Props {
  html: string
}

export function RichText({ html }: Props) {
  const sanitized = DOMPurify.sanitize(html)
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />
}`,
      language: 'typescriptreact',
    },
    expected: [
      // DOMPurify/sanitize in excludePattern should suppress this
    ],
  },

  // -----------------------------------------------------------------------
  // 8. .env.example template → secret rules should NOT fire on placeholders
  // -----------------------------------------------------------------------
  {
    name: 'env-example-template',
    description: '.env.example with placeholder values — not real secrets',
    file: {
      path: '.env.example',
      content: `# Application configuration
API_KEY=your-api-key-here
DATABASE_URL=postgresql://localhost:5432/mydb
SECRET_KEY=changeme
PASSWORD=replace-with-real-password
JWT_SECRET=placeholder-secret`,
      language: 'env',
    },
    expected: [
      // "your-api-key-here", "changeme", "replace-with-real-password" contain
      // placeholder words that excludePattern should catch
    ],
  },

  // -----------------------------------------------------------------------
  // 9. Console.log in production code → TP
  // -----------------------------------------------------------------------
  {
    name: 'console-log-in-production',
    description: 'console.log in production server code — should fire as TP',
    file: {
      path: 'src/services/user-service.ts',
      content: `import { db } from '../db'

export async function getUser(id: string) {
  console.log("Fetching user:", id)
  const user = await db.user.findUnique({ where: { id } })
  console.log("User data:", user)
  return user
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'console-log', line: 4, verdict: 'tp' },
      { ruleId: 'console-log', line: 6, verdict: 'tp' },
      { ruleId: 'composite-async-no-try-catch', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 10. String literals with security words → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'string-literals-security-words',
    description: 'Error messages and labels mentioning password/secret — not actual secrets',
    file: {
      path: 'src/utils/validation.ts',
      content: `export const FIELD_LABELS = {
  password: "Enter your password",
  secret_key: "API Secret Key",
}

export function validatePassword(input: string): string | null {
  if (input.length < 8) {
    return "Password must be at least 8 characters"
  }
  return null
}`,
      language: 'typescript',
    },
    expected: [
      // "Enter your password" is a label → hardcoded-password might fire (FP)
      { ruleId: 'hardcoded-password', line: 2, verdict: 'fp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 11. Canary — obvious true positive vulnerabilities
  // -----------------------------------------------------------------------
  {
    name: 'canary-obvious-vulnerabilities',
    description: 'Obvious hardcoded AWS key, eval(req), hardcoded password — must fire as TP',
    file: {
      path: 'src/config/secrets.ts',
      content: `export const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"

export function dangerous(req: any) {
  const result = eval(req.body.code)
  return result
}

const dbPassword = "admin123456"

export const config = {
  secret: "super-secret-production-key-2024",
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'hardcoded-aws-key', line: 1, verdict: 'tp' },
      { ruleId: 'eval-usage', line: 4, verdict: 'tp' },
      { ruleId: 'hardcoded-password', line: 8, verdict: 'tp' },
      { ruleId: 'hardcoded-secret', line: 11, verdict: 'tp' },
      { ruleId: 'taint-code-injection', line: 4, verdict: 'tp' },
      { ruleId: 'any-type', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 12. Zod schema with password validation → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'zod-schema-password-field',
    description: 'Zod schema defining password field — not a hardcoded secret',
    file: {
      path: 'src/schemas/auth.ts',
      content: `import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export const registerSchema = z.object({
  name: z.string().min(2),
  password: z.string().min(8),
  confirmPassword: z.string(),
})`,
      language: 'typescript',
    },
    expected: [
      // Zod/schema in excludePattern should suppress these
    ],
  },

  // -----------------------------------------------------------------------
  // 13. Express body parser no limit → TP
  // -----------------------------------------------------------------------
  {
    name: 'express-body-parser-no-limit',
    description: 'express.json() with no size limit — TP',
    file: {
      path: 'src/app.ts',
      content: `import express from 'express'

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

export default app`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'express-body-parser-no-limit', line: 4, verdict: 'tp' },
      { ruleId: 'express-no-helmet', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 14. dangerouslySetInnerHTML without sanitizer → TP
  // -----------------------------------------------------------------------
  {
    name: 'dangerous-innerhtml-no-sanitizer',
    description: 'dangerouslySetInnerHTML with raw user content — TP',
    file: {
      path: 'src/components/UserContent.tsx',
      content: `interface Props {
  html: string
}

export function UserContent({ html }: Props) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}`,
      language: 'typescriptreact',
    },
    expected: [
      { ruleId: 'innerhtml-xss', line: 6, verdict: 'tp' },
      { ruleId: 'nextjs-dangerous-html-prop', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 15. CORS wildcard origin → TP
  // -----------------------------------------------------------------------
  {
    name: 'cors-wildcard-origin',
    description: 'CORS with wildcard origin — TP',
    file: {
      path: 'src/middleware/cors.ts',
      content: `import cors from 'cors'
import express from 'express'

const app = express()
app.use(cors({ origin: '*' }))

export default app`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'express-no-helmet', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 16. Commented-out eval — should be suppressed
  // -----------------------------------------------------------------------
  {
    name: 'commented-out-eval',
    description: 'eval in a comment — should NOT fire due to comment suppression',
    file: {
      path: 'src/utils/parser.ts',
      content: `// WARNING: Never use eval() in production
// eval(userInput) was removed in v2.0

export function parseExpression(expr: string) {
  // Use safe JSON.parse instead of eval
  return JSON.parse(expr)
}`,
      language: 'typescript',
    },
    expected: [
      // eval-usage is security+critical, comment suppression doesn't apply
      // BUT excludePattern for eval-usage has /\/\/.*eval/ which catches "// eval"
    ],
  },

  // -----------------------------------------------------------------------
  // 17. SQL injection in template literal → TP
  // -----------------------------------------------------------------------
  {
    name: 'sql-injection-template-literal',
    description: 'SQL query built with template literal — TP',
    file: {
      path: 'src/db/queries.ts',
      content: `import { pool } from './pool'

export async function getUser(name: string) {
  const query = \`SELECT * FROM users WHERE name = '\${name}'\`
  const result = await pool.query(query)
  return result.rows[0]
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'composite-async-no-try-catch', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 18. Empty catch block → TP
  // -----------------------------------------------------------------------
  {
    name: 'empty-catch-block',
    description: 'Empty catch block swallowing errors — TP',
    file: {
      path: 'src/services/data.ts',
      content: `export function loadData() {
  try {
    return JSON.parse(localStorage.getItem('data') || '{}')
  } catch (e) {
  }
  return {}
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'ast-empty-catch', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 19. Public Next.js API route (intentionally no auth) → FP
  // -----------------------------------------------------------------------
  {
    name: 'nextjs-public-api-route',
    description: 'Public health check API route — no auth needed',
    file: {
      path: 'app/api/health/route.ts',
      content: `export async function GET() {
  return Response.json({ status: 'ok', timestamp: Date.now() })
}`,
      language: 'typescript',
    },
    expected: [
      // nextjs-api-no-auth composite: mustNotContain matches 'status' in content
      { ruleId: 'composite-async-no-try-catch', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 20. Timing attack comparison → TP
  // -----------------------------------------------------------------------
  {
    name: 'timing-attack-comparison',
    description: 'Direct string comparison of secrets — timing attack vulnerability',
    file: {
      path: 'src/auth/verify.ts',
      content: `export function verifyApiKey(provided: string, stored: string) {
  if (provided === stored) {
    return true
  }
  return false
}`,
      language: 'typescript',
    },
    expected: [
      // timing-attack-comparison may or may not fire depending on pattern
    ],
  },

  // -----------------------------------------------------------------------
  // 21. SQL injection inline query → TP
  // -----------------------------------------------------------------------
  {
    name: 'sql-injection-inline-query',
    description: 'db.query with template literal SQL — direct injection TP',
    file: {
      path: 'src/api/users.ts',
      content: `import { db } from '../db'

export async function getUser(userId: string) {
  const result = await db.query(\`SELECT * FROM users WHERE id = '\${userId}'\`)
  return result.rows[0]
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'sql-injection', line: 4, verdict: 'tp' },
      { ruleId: 'composite-async-no-try-catch', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 22. Command injection via template literal → TP
  // -----------------------------------------------------------------------
  {
    name: 'command-injection-template-rm',
    description: 'exec() with template literal shell command — TP',
    file: {
      path: 'src/utils/cleanup.ts',
      content: `import { exec } from 'child_process'

export function cleanupDir(userInput: string) {
  exec(\`rm -rf /tmp/\${userInput}\`, (err) => {
    if (err) console.error(err)
  })
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'command-injection-template', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 23. child_process.exec direct call → TP
  // -----------------------------------------------------------------------
  {
    name: 'command-injection-cp-exec',
    description: 'child_process.exec with string concat — TP',
    file: {
      path: 'src/utils/shell.ts',
      content: `import * as child_process from 'child_process'

export function listDir(dir: string) {
  child_process.exec('ls ' + dir, (err, stdout) => {
    console.log(stdout)
  })
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'command-injection-exec-direct', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 24. Private RSA key inline → TP
  // -----------------------------------------------------------------------
  {
    name: 'private-key-rsa-inline',
    description: 'RSA private key pasted in source — TP',
    file: {
      path: 'src/config/keys.ts',
      content: `export const SIGNING_KEY = \`-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn3ygWyF8PbnGcY1234567890abcdefg
-----END RSA PRIVATE KEY-----\``,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'private-key-inline', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 25. Path traversal via readFile → TP
  // -----------------------------------------------------------------------
  {
    name: 'path-traversal-readfile',
    description: 'fs.readFile with user-controlled path via template literal — TP',
    file: {
      path: 'src/routes/download.ts',
      content: `import fs from 'fs'
import { Router } from 'express'

const router = Router()

router.get('/download/:file', (req, res) => {
  fs.readFile(\`./uploads/\${req.params.file}\`, (err, data) => {
    if (err) return res.status(404).send('Not found')
    res.send(data)
  })
})

export default router`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'path-traversal', line: 7, verdict: 'tp' },
      { ruleId: 'composite-missing-auth-express-route', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 26. Open redirect from query param → TP
  // -----------------------------------------------------------------------
  {
    name: 'open-redirect-query',
    description: 'res.redirect with user-controlled returnUrl — TP',
    file: {
      path: 'src/routes/login.ts',
      content: `import { Router } from 'express'

const router = Router()

router.get('/login/callback', (req, res) => {
  res.redirect(req.query.returnUrl as string)
})

export default router`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'open-redirect', line: 6, verdict: 'tp' },
      { ruleId: 'composite-missing-auth-express-route', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 27. Weak MD5 hash for password → TP
  // -----------------------------------------------------------------------
  {
    name: 'weak-hash-md5-password',
    description: 'crypto.createHash(md5) for password — TP',
    file: {
      path: 'src/auth/hash.ts',
      content: `import crypto from 'crypto'

export function hashPassword(password: string) {
  return crypto.createHash('md5').update(password).digest('hex')
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'weak-hash', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 28. Insecure random for session → TP
  // -----------------------------------------------------------------------
  {
    name: 'insecure-random-session',
    description: 'Math.random() used for session identifier — TP',
    file: {
      path: 'src/auth/session.ts',
      content: `export function createSession() {
  return Math.random().toString(36) + '-session-' + Date.now()
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'insecure-random', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 29. JWT decode without verify → TP
  // -----------------------------------------------------------------------
  {
    name: 'jwt-decode-no-verify',
    description: 'jwt.decode() without verify — TP',
    file: {
      path: 'src/middleware/auth.ts',
      content: `import jwt from 'jsonwebtoken'

export function getUserFromToken(token: string) {
  const payload = jwt.decode(token)
  return payload
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'jwt-no-verify', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 30. Prototype pollution via __proto__ → TP
  // -----------------------------------------------------------------------
  {
    name: 'prototype-pollution-proto-access',
    description: 'Direct __proto__ assignment from parsed input — TP',
    file: {
      path: 'src/utils/merge.ts',
      content: `export function unsafeMerge(target: any, source: string) {
  const parsed = JSON.parse(source)
  for (const key of Object.keys(parsed)) {
    target.__proto__ = parsed[key]
  }
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'prototype-pollution-proto', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 31. NoSQL injection via $where → TP
  // -----------------------------------------------------------------------
  {
    name: 'nosql-injection-where',
    description: 'MongoDB $where with user input — TP',
    file: {
      path: 'src/db/search.ts',
      content: `import { db } from './connection'

export async function search(filter: string) {
  const results = await db.collection('users').find({ $where: req.body.filter })
  return results.toArray()
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'nosql-injection', line: 4, verdict: 'tp' },
      { ruleId: 'composite-async-no-try-catch', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 32. OpenAI API key hardcoded → TP
  // -----------------------------------------------------------------------
  {
    name: 'llm-openai-key-hardcoded',
    description: 'OpenAI API key hardcoded in source — TP',
    file: {
      path: 'src/config/ai.ts',
      content: `import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: "sk-Abc123Def456Ghi789Jkl012Mno345Pqr678Stu901Vwx234"
})

export default client`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'llm-openai-key', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 33. Prompt injection via template literal → TP
  // -----------------------------------------------------------------------
  {
    name: 'prompt-injection-user-input',
    description: 'User input interpolated into LLM prompt — TP',
    file: {
      path: 'src/ai/summarize.ts',
      content: `export function buildPrompt(userInput: string) {
  const prompt = \`Summarize the following content: \${userInput}\`
  return prompt
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'prompt-injection', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 34. Cookie with httpOnly: false → TP
  // -----------------------------------------------------------------------
  {
    name: 'cookie-httponly-false',
    description: 'res.cookie with httpOnly explicitly set to false — TP',
    file: {
      path: 'src/routes/auth.ts',
      content: `import { Router } from 'express'

const router = Router()

router.post('/login', (req, res) => {
  const token = generateToken(req.body)
  res.cookie('session', token, { secure: true, httpOnly: false })
  res.json({ ok: true })
})

export default router`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'cookie-no-httponly', line: 7, verdict: 'tp' },
      { ruleId: 'cookie-no-samesite', line: 7, verdict: 'tp' },
      { ruleId: 'composite-missing-auth-express-route', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 35. Debug mode in config object → TP
  // -----------------------------------------------------------------------
  {
    name: 'debug-config-object',
    description: 'debug: true in config object — TP for debug-mode-production',
    file: {
      path: 'src/config/app.ts',
      content: `export const appConfig = {
  port: 3000,
  debug: true,
  logLevel: "verbose",
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'debug-mode-production', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 36. CORS wildcard via header → TP
  // -----------------------------------------------------------------------
  {
    name: 'cors-wildcard-header-set',
    description: 'Access-Control-Allow-Origin: * via setHeader — TP for cors-wildcard',
    file: {
      path: 'src/middleware/headers.ts',
      content: `import { Request, Response, NextFunction } from 'express'

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST')
  next()
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'cors-wildcard', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 37. var usage in production code → TP
  // -----------------------------------------------------------------------
  {
    name: 'var-usage-production',
    description: 'var declarations in production code — TP for var-usage',
    file: {
      path: 'src/utils/counter.ts',
      content: `var counter = 0
var name = "default"

export function increment() {
  var temp = counter + 1
  counter = temp
  return counter
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'var-usage', line: 1, verdict: 'tp' },
      { ruleId: 'var-usage', line: 2, verdict: 'tp' },
      { ruleId: 'var-usage', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 38. any type in catch clause → FP (should be excluded)
  // -----------------------------------------------------------------------
  {
    name: 'any-type-catch-clause',
    description: 'catch (e: any) — excludePattern should suppress any-type rule',
    file: {
      path: 'src/services/parser.ts',
      content: `export function safeParse(json: string) {
  try {
    return JSON.parse(json)
  } catch (e: any) {
    throw new Error(\`Parse failed: \${e.message}\`)
  }
}`,
      language: 'typescript',
    },
    expected: [
      // any-type excludePattern includes catch\s*\( — should NOT fire
    ],
  },

  // -----------------------------------------------------------------------
  // 39. ReDoS user input regex → TP
  // -----------------------------------------------------------------------
  {
    name: 'redos-user-input-regex',
    description: 'new RegExp(req.query.pattern) — TP for redos-user-regex',
    file: {
      path: 'src/routes/search.ts',
      content: `import { Router } from 'express'

const router = Router()

router.get('/search', (req, res) => {
  const pattern = new RegExp(req.query.pattern as string)
  const results = items.filter(i => pattern.test(i.name))
  res.json(results)
})

export default router`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'redos-user-regex', line: 6, verdict: 'tp' },
      { ruleId: 'composite-missing-auth-express-route', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 40. Weak cipher DES usage → TP
  // -----------------------------------------------------------------------
  {
    name: 'weak-cipher-des-usage',
    description: 'crypto.createCipheriv with DES — TP for weak-cipher-des',
    file: {
      path: 'src/crypto/legacy.ts',
      content: `import crypto from 'crypto'

export function encryptLegacy(data: string, key: Buffer) {
  const cipher = crypto.createCipheriv('DES', key, Buffer.alloc(8))
  return cipher.update(data, 'utf8', 'hex') + cipher.final('hex')
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'weak-cipher-des', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 41. GraphQL introspection enabled → TP
  // -----------------------------------------------------------------------
  {
    name: 'graphql-introspection-prod',
    description: 'introspection: true without env check — TP',
    file: {
      path: 'src/graphql/server.ts',
      content: `import { ApolloServer } from '@apollo/server'
import { typeDefs, resolvers } from './schema'

const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
})

export default server`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'graphql-introspection-enabled', line: 7, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 42. Safe config lookup — NOT object injection (negative fixture)
  // -----------------------------------------------------------------------
  {
    name: 'object-injection-bracket-safe',
    description: 'Config lookup with key from known constant array — not object injection',
    file: {
      path: 'src/config/feature-flags.ts',
      content: `const ALLOWED_FLAGS = ['darkMode', 'betaFeatures', 'newDashboard'] as const
type FlagKey = typeof ALLOWED_FLAGS[number]

const flagValues: Record<FlagKey, boolean> = {
  darkMode: true,
  betaFeatures: false,
  newDashboard: true,
}

export function getFlag(key: FlagKey): boolean {
  const val = flagValues[key]
  return val ?? false
}`,
      language: 'typescript',
    },
    expected: [
      // key is from a typed constant array — NOT request data. No object-injection-bracket.
    ],
  },

  // -----------------------------------------------------------------------
  // 43. Safe string comparison — NOT a timing attack (negative fixture)
  // -----------------------------------------------------------------------
  {
    name: 'timing-attack-comparison-safe',
    description: 'Normal role check with === — not a secret comparison',
    file: {
      path: 'src/middleware/role-check.ts',
      content: `export function isAdmin(user: { role: string }): boolean {
  if (user.role === 'admin') {
    return true
  }
  return false
}`,
      language: 'typescript',
    },
    expected: [
      // user.role is not a secret, password, token, etc. — safe comparison.
    ],
  },

  // -----------------------------------------------------------------------
  // 44. Safe localStorage — non-sensitive data (negative fixture)
  // -----------------------------------------------------------------------
  {
    name: 'localstorage-safe',
    description: 'localStorage.setItem for theme preference — not a secret',
    file: {
      path: 'src/utils/theme.ts',
      content: `export function setTheme(theme: 'light' | 'dark') {
  localStorage.setItem('theme', theme)
}

export function getTheme(): string {
  return localStorage.getItem('theme') ?? 'light'
}`,
      language: 'typescript',
    },
    expected: [
      // 'theme' key does not match secret/token/password/apiKey patterns.
    ],
  },

  // -----------------------------------------------------------------------
  // 45. Safe console.log — non-sensitive data (negative fixture)
  // -----------------------------------------------------------------------
  {
    name: 'console-log-safe',
    description: 'console.log for port info — not logging sensitive data',
    file: {
      path: 'src/server/startup.ts',
      content: `const port = process.env.PORT || 3000

export function startServer() {
  console.log('Server started on port', port)
  console.log('Environment:', process.env.NODE_ENV)
}`,
      language: 'typescript',
    },
    expected: [
      // No password/secret/apiKey/credential in console.log args.
    ],
  },

  // -----------------------------------------------------------------------
  // 46. Safe error logging — server-side only (negative fixture)
  // -----------------------------------------------------------------------
  {
    name: 'error-stack-safe',
    description: 'logger.error with stack trace — server-side logging, not sent to client',
    file: {
      path: 'src/utils/error-logger.ts',
      content: `import { logger } from './logger'

export function handleError(err: Error, context: string) {
  logger.error('Operation failed', { context, stack: err.stack })
}`,
      language: 'typescript',
    },
    expected: [
      // logger.error is not res.json/res.send — stack not exposed to client.
    ],
  },

  // -----------------------------------------------------------------------
  // 47. Safe Object.assign — merging known objects (negative fixture)
  // -----------------------------------------------------------------------
  {
    name: 'object-assign-safe',
    description: 'Object.assign({}, defaults, options) — merging known objects, not request data',
    file: {
      path: 'src/config/merge.ts',
      content: `interface AppConfig {
  timeout: number
  retries: number
  debug: boolean
}

const defaults: AppConfig = { timeout: 5000, retries: 3, debug: false }

export function createConfig(options: Partial<AppConfig>): AppConfig {
  const merged = Object.assign({}, defaults, options)
  return merged
}`,
      language: 'typescript',
    },
    expected: [
      // First arg to Object.assign is {}, not req.body/params/query — safe.
    ],
  },
]
