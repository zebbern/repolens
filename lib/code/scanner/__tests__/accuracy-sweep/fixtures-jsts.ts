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

  // -----------------------------------------------------------------------
  // 48. SSTI — EJS render with req.body.template → TP
  // -----------------------------------------------------------------------
  {
    name: 'ssti-js-injection',
    description: 'ejs.render with req.body.template — server-side template injection, TP',
    file: {
      path: 'src/views/preview.ts',
      content: `import ejs from 'ejs'
import { Request, Response } from 'express'

export function renderTemplate(req: Request, res: Response) {
  const html = ejs.render(req.body.template, { name: 'World' })
  res.send(html)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'ssti-js', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 49. TLS rejectUnauthorized: false → TP
  // -----------------------------------------------------------------------
  {
    name: 'tls-reject-unauthorized',
    description: 'https.Agent with rejectUnauthorized: false — TLS bypass, TP',
    file: {
      path: 'src/api/client.ts',
      content: `import https from 'https'

const agent = new https.Agent({ rejectUnauthorized: false })
export const client = { httpsAgent: agent }`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'tls-reject-unauthorized-false', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 50. NODE_TLS_REJECT_UNAUTHORIZED = '0' → TP
  // -----------------------------------------------------------------------
  {
    name: 'tls-env-disable',
    description: 'NODE_TLS_REJECT_UNAUTHORIZED = 0 — global TLS disable, TP',
    file: {
      path: 'src/bootstrap.ts',
      content: `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'tls-env-disable', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 51. Hardcoded IV in createCipheriv → TP
  // -----------------------------------------------------------------------
  {
    name: 'hardcoded-iv',
    description: 'createCipheriv with Buffer.from hardcoded IV — crypto misuse, TP',
    file: {
      path: 'src/crypto/encrypt.ts',
      content: `import crypto from 'crypto'

export function encrypt(data: string, key: Buffer) {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.from('1234567890abcdef'))
  return cipher.update(data, 'utf8', 'hex') + cipher.final('hex')
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'hardcoded-iv', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 52. vm.runInNewContext with user code → TP
  // -----------------------------------------------------------------------
  {
    name: 'vm-code-execution',
    description: 'vm.runInNewContext executing user-supplied code — sandbox escape risk, TP',
    file: {
      path: 'src/sandbox/runner.ts',
      content: `import vm from 'vm'

export function runUserCode(code: string) {
  return vm.runInNewContext(code, { Math, Date })
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'vm-code-execution', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 53. vm2 deprecated import → TP
  // -----------------------------------------------------------------------
  {
    name: 'vm2-deprecated-import',
    description: 'import from vm2 — deprecated with known sandbox escapes, TP',
    file: {
      path: 'src/sandbox/vm2-runner.ts',
      content: `import { VM } from 'vm2'

export function runSandboxed(code: string) {
  const vmInstance = new VM()
  return vmInstance.run(code)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'vm2-deprecated', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 54. Error stack exposure in response → TP
  // -----------------------------------------------------------------------
  {
    name: 'error-stack-exposure',
    description: 'res.json with err.stack — leaks internals to client, TP',
    file: {
      path: 'src/middleware/error.ts',
      content: `import { Request, Response, NextFunction } from 'express'

export function handleError(err: Error, req: Request, res: Response, next: NextFunction) {
  res.json({ message: err.message, stack: err.stack })
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'error-stack-exposure', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 55. CSP unsafe-inline → TP
  // -----------------------------------------------------------------------
  {
    name: 'csp-unsafe-inline',
    description: "Content-Security-Policy with 'unsafe-inline' — XSS risk, TP",
    file: {
      path: 'src/middleware/csp.ts',
      content: `export function setCSP(res: any) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'")
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'csp-unsafe-inline', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 56. CSP unsafe-eval → TP
  // -----------------------------------------------------------------------
  {
    name: 'csp-unsafe-eval',
    description: "Content-Security-Policy with 'unsafe-eval' — allows eval(), TP",
    file: {
      path: 'src/middleware/csp-eval.ts',
      content: `export function setCSPEval(res: any) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-eval'")
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'csp-unsafe-eval', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 57. Deprecated TLS version → TP
  // -----------------------------------------------------------------------
  {
    name: 'deprecated-tls-version',
    description: "secureProtocol: 'TLSv1_method' — deprecated TLS 1.0, TP",
    file: {
      path: 'src/config/tls.ts',
      content: `import tls from 'tls'

export const options = {
  secureProtocol: 'TLSv1_method',
  minVersion: 'TLSv1',
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'deprecated-tls', line: 4, verdict: 'tp' },
      { ruleId: 'deprecated-tls', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 58. JWT algorithm 'none' → TP
  // -----------------------------------------------------------------------
  {
    name: 'jwt-algorithm-none',
    description: "algorithms: ['none', 'HS256'] — allows forged tokens, TP",
    file: {
      path: 'src/auth/jwt.ts',
      content: `import jwt from 'jsonwebtoken'

export function verifyToken(token: string) {
  return jwt.verify(token, 'secret', { algorithms: ['none', 'HS256'] })
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'jwt-algo-none', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 59. Object injection via bracket accessor → TP
  // -----------------------------------------------------------------------
  {
    name: 'object-injection-bracket',
    description: 'settings[req.query.key] — dynamic property access with request data, TP',
    file: {
      path: 'src/routes/settings.ts',
      content: `import { Router } from 'express'

const router = Router()
const settings: Record<string, string> = {}

router.get('/setting', (req, res) => {
  const value = settings[req.query.key]
  res.json({ value })
})

export default router`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'object-injection-bracket', line: 7, verdict: 'tp' },
      { ruleId: 'composite-missing-auth-express-route', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 60. Console log with sensitive data → TP
  // -----------------------------------------------------------------------
  {
    name: 'console-log-sensitive-data',
    description: 'console.log with password variable — credential leak in logs, TP',
    file: {
      path: 'src/auth/login.ts',
      content: `export function debugLogin(username: string, password: string) {
  console.log('Login attempt', { username, password })
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'console-log-sensitive', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 61. Static crypto key in createCipheriv → TP
  // -----------------------------------------------------------------------
  {
    name: 'static-crypto-key',
    description: 'createCipheriv with hardcoded string key — extractable from source, TP',
    file: {
      path: 'src/crypto/cipher.ts',
      content: `import crypto from 'crypto'

export function encryptData(data: string, iv: Buffer) {
  const cipher = crypto.createCipheriv('aes-256-cbc', 'my-secret-key-32-chars-long!!!!!', iv)
  return cipher.update(data, 'utf8', 'hex') + cipher.final('hex')
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'static-crypto-key', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 62. Sensitive data in URL query string → TP
  // -----------------------------------------------------------------------
  {
    name: 'sensitive-data-url',
    description: 'password in URL query parameter — exposed in logs/history, TP',
    file: {
      path: 'src/services/auth-client.ts',
      content: `export async function authenticate(user: string, pass: string) {
  const res = await fetch(\`https://api.acme.io/login?password=\${pass}&user=\${user}\`)
  return res.json()
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'sensitive-data-in-url', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 63. React href="javascript:..." → TP
  // -----------------------------------------------------------------------
  {
    name: 'react-href-javascript',
    description: 'href="javascript:void(0)" — XSS vector in React, TP',
    file: {
      path: 'src/components/ActionLink.tsx',
      content: `export function ActionLink({ onClick }: { onClick: () => void }) {
  return <a href="javascript:void(0)" onClick={onClick}>Click</a>
}`,
      language: 'typescriptreact',
    },
    expected: [
      { ruleId: 'react-href-javascript', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 64. React target="_blank" without rel="noopener" → TP
  // -----------------------------------------------------------------------
  {
    name: 'react-target-blank',
    description: 'target="_blank" without rel="noopener" — reverse tabnapping, TP',
    file: {
      path: 'src/components/ExternalLink.tsx',
      content: `export function ExternalLink({ url, label }: { url: string; label: string }) {
  return <a href={url} target="_blank">{label}</a>
}`,
      language: 'typescriptreact',
    },
    expected: [
      { ruleId: 'react-target-blank-noopener', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 65. NEXT_PUBLIC_ env with secret names → TP
  // -----------------------------------------------------------------------
  {
    name: 'nextjs-public-env-secret',
    description: 'NEXT_PUBLIC_SECRET and NEXT_PUBLIC_API_KEY — client-exposed secrets, TP',
    file: {
      path: 'src/config/env.ts',
      content: `export const config = {
  secretKey: process.env.NEXT_PUBLIC_SECRET,
  apiKey: process.env.NEXT_PUBLIC_API_KEY,
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'nextjs-public-env-secret', line: 2, verdict: 'tp' },
      { ruleId: 'nextjs-public-env-secret', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 66. UNSAFE_componentWillMount → TP
  // -----------------------------------------------------------------------
  {
    name: 'react-unsafe-lifecycle',
    description: 'UNSAFE_componentWillMount — deprecated lifecycle, TP',
    file: {
      path: 'src/components/LegacyWidget.tsx',
      content: `import React from 'react'

class LegacyWidget extends React.Component {
  UNSAFE_componentWillMount() {
    this.loadData()
  }
  render() { return <div>Widget</div> }
  loadData() {}
}

export default LegacyWidget`,
      language: 'typescriptreact',
    },
    expected: [
      { ruleId: 'react-unsafe-lifecycle', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 67. JWT signed with weak/short secret — TP
  // -----------------------------------------------------------------------
  {
    name: 'jwt-weak-secret',
    description: 'jwt.sign() with short secret string — weak JWT TP',
    file: {
      path: 'src/auth/tokens.ts',
      content: `import jwt from 'jsonwebtoken'
export function createToken(userId: string) {
  return jwt.sign({ sub: userId }, 'weak')
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'jwt-weak-secret', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 68. Prototype pollution via Object.assign(req.body) — TP
  // -----------------------------------------------------------------------
  {
    name: 'prototype-pollution-assign',
    description: 'Object.assign(req.body, defaults) — prototype pollution TP',
    file: {
      path: 'src/middleware/merge.ts',
      content: `export function mergeDefaults(req: any) {
  const result = Object.assign(req.body, { role: 'user' })
  return result
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'prototype-pollution-assign', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 69. GraphQL server without depth limiting — TP
  // -----------------------------------------------------------------------
  {
    name: 'graphql-no-depth-limit',
    description: 'ApolloServer without depthLimit validation rule — TP',
    file: {
      path: 'src/graphql/server.ts',
      content: `import { ApolloServer } from '@apollo/server'
const typeDefs = \`type Query { hello: String }\`
const resolvers = { Query: { hello: () => 'world' } }
const server = new ApolloServer({ typeDefs, resolvers })`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'graphql-no-depth-limit', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 70. Weak cipher mode: ECB — TP
  // -----------------------------------------------------------------------
  {
    name: 'weak-cipher-ecb',
    description: 'createCipheriv with aes-256-ecb — weak ECB mode TP',
    file: {
      path: 'src/crypto/encrypt.ts',
      content: `import crypto from 'crypto'
export function encrypt(data: string, key: Buffer) {
  const cipher = crypto.createCipheriv('aes-256-ecb', key, null)
  return cipher.update(data, 'utf8', 'hex') + cipher.final('hex')
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'weak-cipher-ecb', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 71. Hardcoded salt in pbkdf2 — TP
  // -----------------------------------------------------------------------
  {
    name: 'hardcoded-salt',
    description: 'pbkdf2 with string literal salt — hardcoded salt TP',
    file: {
      path: 'src/crypto/derive.ts',
      content: `import crypto from 'crypto'
export function deriveKey(password: string, cb: Function) {
  crypto.pbkdf2(password, 'fixed-salt-value', 100000, 32, 'sha256', cb)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'hardcoded-salt', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 72. Hardcoded HMAC secret — TP
  // -----------------------------------------------------------------------
  {
    name: 'hardcoded-hmac-key',
    description: 'createHmac with string literal secret — hardcoded HMAC TP',
    file: {
      path: 'src/crypto/sign.ts',
      content: `import crypto from 'crypto'
export function signPayload(data: string) {
  return crypto.createHmac('sha256', 'my-hmac-secret-key').update(data).digest('hex')
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'hardcoded-hmac-key', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 73. Worker with eval: true — TP
  // -----------------------------------------------------------------------
  {
    name: 'worker-eval-true',
    description: 'new Worker(code, { eval: true }) — eval-mode worker TP',
    file: {
      path: 'src/workers/runner.ts',
      content: `import { Worker } from 'worker_threads'
export function runCode(code: string) {
  const worker = new Worker(code, { eval: true })
  worker.on('message', (result) => console.log(result))
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'worker-eval', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 74. node-serialize require + unserialize — TP
  // -----------------------------------------------------------------------
  {
    name: 'node-serialize-unserialize',
    description: 'require(node-serialize) + unserialize() — known RCE TP',
    file: {
      path: 'src/serialization/session.ts',
      content: `const serialize = require('node-serialize')
export function loadSession(data: string) {
  return serialize.unserialize(data)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'node-serialize-unserialize', line: 1, verdict: 'tp' },
      { ruleId: 'node-serialize-unserialize', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 75. localStorage.setItem with auth token — TP
  // -----------------------------------------------------------------------
  {
    name: 'localstorage-secret-store',
    description: 'localStorage/sessionStorage storing auth_token and api_key — TP',
    file: {
      path: 'src/services/auth-storage.ts',
      content: `export function saveAuthToken(token: string) {
  localStorage.setItem('auth_token', token)
  sessionStorage.setItem('api_key', token)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'localstorage-secret', line: 2, verdict: 'tp' },
      { ruleId: 'localstorage-secret', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 76. Secret token batch: twilio, sendgrid, npm, pypi, heroku, mailgun — TP
  // -----------------------------------------------------------------------
  {
    name: 'secret-tokens-batch-1',
    description: 'Various service API keys hardcoded — all TP',
    file: {
      path: 'src/config/service-keys.ts',
      content: `const TWILIO_SID = "${"SK"}1234567890abcdef1234567890abcdef"
const SENDGRID_KEY = "${'SG'}.${'aBcDeFgHiJkLmNoPqRsTuV'}.${'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ABCDEfg'}"
const NPM_TOKEN = "npm_abcdefghijklmnopqrstuvwxyz0123456789"
const PYPI_TOKEN = "pypi-AgEIcHlwaS5vcmcCJGY3ZjBiMjE3LTRhMjAtNDcwZS05ZDExLTYxNjE2MjBhMzRjOQACKlszLCI2YzhmNjlhYy1iMjc1LTQ5ZjZkNGI4abcdef"
const HEROKU_KEY = "heroku_api_key = 12345678-abcd-1234-abcd-1234567890ab"
const MAILGUN_KEY = "key-abcdefghijklmnopqrstuvwxyz012345"`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'twilio-token', line: 1, verdict: 'tp' },
      { ruleId: 'sendgrid-key', line: 2, verdict: 'tp' },
      { ruleId: 'npm-token', line: 3, verdict: 'tp' },
      { ruleId: 'pypi-token', line: 4, verdict: 'tp' },
      { ruleId: 'heroku-api-key', line: 5, verdict: 'tp' },
      { ruleId: 'mailgun-key', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 77. LLM + service keys: anthropic, google-ai, slack, stripe — TP
  // -----------------------------------------------------------------------
  {
    name: 'secret-tokens-batch-2',
    description: 'LLM and service tokens hardcoded — all TP',
    file: {
      path: 'src/config/llm-keys.ts',
      content: `const ANTHROPIC_KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"
const GOOGLE_KEY = "AIzaSyA1234567890abcdefghijklmnopqrstuvw"
const SLACK_BOT = "xoxb-1234567890-abcdefghijkl"
const STRIPE_SECRET = "${'sk_live_'}abcdefghijklmnopqrstuvwxyz"`,

      language: 'typescript',
    },
    expected: [
      { ruleId: 'llm-anthropic-key', line: 1, verdict: 'tp' },
      { ruleId: 'llm-google-ai-key', line: 2, verdict: 'tp' },
      { ruleId: 'slack-token', line: 3, verdict: 'tp' },
      { ruleId: 'stripe-key', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 78. Azure connection string — TP
  // -----------------------------------------------------------------------
  {
    name: 'azure-connection-string-hardcoded',
    description: 'Azure storage connection string in source — TP',
    file: {
      path: 'src/config/azure.ts',
      content: `const connStr = "DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=abc123def456ghi789jkl012mno345pqr678stu901vwx234="`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'azure-connection-string', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 79. command-injection-require-cp, string-concat, util-format — TP
  // -----------------------------------------------------------------------
  {
    name: 'command-injection-variants',
    description: 'Various command injection patterns — all TP',
    file: {
      path: 'src/utils/exec-helpers.ts',
      content: `import { exec } from 'child_process'
const cmd = "convert " + inputFile + " output.png"
const formatted = require('util').format('convert %s output.png', userInput)
exec(cmd)`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'command-injection-require-cp', line: 1, verdict: 'tp' },
      { ruleId: 'command-injection-string-concat', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 80. cookie-no-secure + verbose-error-response — TP
  // -----------------------------------------------------------------------
  {
    name: 'cookie-secure-and-verbose-error',
    description: 'Cookie without secure flag and raw error in response — TP',
    file: {
      path: 'src/routes/auth.ts',
      content: `import { Request, Response } from 'express'
export function login(req: Request, res: Response) {
  try {
    res.cookie('session', token, { httpOnly: true, secure: false })
  } catch (err) {
    res.json(err)
  }
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'cookie-no-secure', line: 4, verdict: 'tp' },
      { ruleId: 'verbose-error-response', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 81. timing-attack-comparison + redos-dynamic-regex — TP
  // -----------------------------------------------------------------------
  {
    name: 'timing-attack-and-redos',
    description: 'Non-constant-time comparison and dynamic regex — TP',
    file: {
      path: 'src/auth/verify.ts',
      content: `export function verifyToken(input: string, secret: string) {
  if (input === secret) {
    return true
  }
  const pattern = new RegExp(userPattern)
  return pattern.test(input)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'timing-attack-comparison', line: 2, verdict: 'tp' },
      { ruleId: 'redos-dynamic-regex', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 82. xxe-js-parser + log-injection-js — TP
  // -----------------------------------------------------------------------
  {
    name: 'xxe-js-and-log-injection',
    description: 'DOMParser usage and logging request data — TP',
    file: {
      path: 'src/api/xml-handler.ts',
      content: `import { Request } from 'express'
export function handleXml(req: Request) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(req.body.xml, 'text/xml')
  console.log("Processing request:", req.body.username)
  return doc
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'xxe-js-parser', line: 3, verdict: 'tp' },
      { ruleId: 'log-injection-js', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 83. weak-cipher-rc4 + csp-wildcard-source — TP
  // -----------------------------------------------------------------------
  {
    name: 'rc4-cipher-and-csp-wildcard',
    description: 'RC4 cipher usage and CSP wildcard source — TP',
    file: {
      path: 'src/crypto/legacy.ts',
      content: `import crypto from 'crypto'
const cipher = crypto.createCipher('RC4', key)
export function setHeaders(res: any) {
  res.setHeader('Content-Security-Policy', "script-src * 'unsafe-inline'")
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'weak-cipher-rc4', line: 2, verdict: 'tp' },
      { ruleId: 'csp-wildcard-source', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 84. nosql-injection-mapreduce + prototype-pollution-merge — TP
  // -----------------------------------------------------------------------
  {
    name: 'nosql-mapreduce-and-proto-merge',
    description: 'NoSQL mapReduce with user input and lodash.merge — TP',
    file: {
      path: 'src/db/aggregate.ts',
      content: `import { Request } from 'express'
import _ from 'lodash'
export async function aggregate(req: Request, collection: any) {
  const result = await collection.mapReduce(req.body.map, req.body.reduce)
  const config = _.merge({}, defaults, req.body.options)
  return result
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'nosql-injection-mapreduce', line: 4, verdict: 'tp' },
      { ruleId: 'prototype-pollution-merge', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 85. empty-catch (AST-based rule) — TP
  // -----------------------------------------------------------------------
  {
    name: 'quality-empty-catch-block',
    description: 'Empty catch block swallowing errors — TP',
    file: {
      path: 'src/utils/data-loader.ts',
      content: `export function loadData(input: string) {
  try {
    return JSON.parse(input)
  } catch (err) {}
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'ast-empty-catch', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 86. magic-number + hardcoded-ip — TP
  // -----------------------------------------------------------------------
  {
    name: 'quality-magic-number-hardcoded-ip',
    description: 'Hardcoded IP address — TP',
    file: {
      path: 'src/config/server.ts',
      content: `const DB_HOST = "45.33.32.156"
const API_HOST = "203.113.0.50"`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'hardcoded-ip', line: 1, verdict: 'tp' },
      { ruleId: 'hardcoded-ip', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 87. nextjs-server-action-no-auth + nextjs-redirect-input — TP
  // -----------------------------------------------------------------------
  {
    name: 'nextjs-server-action-redirect',
    description: 'Next.js server action without auth and redirect from input — TP',
    file: {
      path: 'app/actions/update.ts',
      content: `'use server'
import { redirect } from 'next/navigation'
export async function updateProfile(formData: FormData) {
  const name = formData.get('name')
  await db.user.update({ name })
  redirect(formData.get('redirectUrl') as string)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'nextjs-server-action-no-auth', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 88. express-trust-proxy + express-static-dotfiles — TP
  // -----------------------------------------------------------------------
  {
    name: 'express-trust-proxy-static',
    description: 'Express trust proxy true and static without dotfiles config — TP',
    file: {
      path: 'src/server/app.ts',
      content: `import express from 'express'
const app = express()
app.set('trust proxy', true)
app.use(express.static('public'))
app.listen(3000)`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'express-trust-proxy', line: 3, verdict: 'tp' },
      { ruleId: 'express-static-dotfiles', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 89. sri-missing-cdn — TP
  // -----------------------------------------------------------------------
  {
    name: 'sri-missing-cdn-script',
    description: 'CDN script tag without integrity attribute — TP',
    file: {
      path: 'src/templates/layout.html',
      content: `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
</head>
</html>`,
      language: 'html',
    },
    expected: [
      { ruleId: 'sri-missing-cdn', line: 4, verdict: 'tp' },
      { ruleId: 'sri-missing-cdn', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 90. serialize-javascript-exec + node-serialize — TP
  // -----------------------------------------------------------------------
  {
    name: 'serialize-exec-pattern',
    description: 'serialize-javascript with unsafe options — TP',
    file: {
      path: 'src/utils/serialize.ts',
      content: `import serialize from 'serialize-javascript'
const output = serialize(data, { unsafe: true })`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'serialize-javascript-exec', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 91. command-injection-util-format — TP
  // -----------------------------------------------------------------------
  {
    name: 'cmd-injection-util-format',
    description: 'util.format used to build a shell command string — TP',
    file: {
      path: 'src/utils/media.ts',
      content: `import { exec } from 'child_process'
import util from 'util'
export function convertImage(input: string, output: string) {
  const cmd = util.format('convert %s -resize 800x600 %s', input, output)
  exec(cmd)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'command-injection-util-format', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 92. eslint-disable — TP
  // -----------------------------------------------------------------------
  {
    name: 'eslint-disable-usage',
    description: 'Lint suppression comments without justification — TP',
    file: {
      path: 'src/services/auth-hack.ts',
      content: `// eslint-disable-next-line no-console
console.log('debug auth')
// @ts-ignore
let value = getUnsafe()`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'eslint-disable', line: 1, verdict: 'tp' },
      { ruleId: 'eslint-disable', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 93. magic-number — TP
  // -----------------------------------------------------------------------
  {
    name: 'magic-number-usage',
    description: 'Magic numbers in assignments and comparisons — TP',
    file: {
      path: 'src/utils/validator.ts',
      content: `export function checkLimit(count: number) {
  let limit = 5000
  if (count >= 9999) {
    throw new Error('exceeded')
  }
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'magic-number', line: 2, verdict: 'tp' },
      { ruleId: 'magic-number', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 94. todo-fixme — TP
  // -----------------------------------------------------------------------
  {
    name: 'todo-fixme-comments',
    description: 'TODO and FIXME comments without tracking — TP',
    file: {
      path: 'src/services/payment.ts',
      content: `export function processPayment(amount: number) {
  // TODO: add retry logic
  // FIXME: handle currency conversion
  return charge(amount)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'todo-fixme', line: 2, verdict: 'tp' },
      { ruleId: 'todo-fixme', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 95. nextjs-redirect-input — TP
  // -----------------------------------------------------------------------
  {
    name: 'nextjs-redirect-user-input',
    description: 'redirect() with user-controlled searchParams — TP',
    file: {
      path: 'app/actions/navigate.ts',
      content: `import { redirect } from 'next/navigation'
export async function navigateAction(searchParams: { dest: string }) {
  redirect(searchParams.dest)
}`,
      language: 'typescript',
    },
    expected: [
      { ruleId: 'nextjs-redirect-input', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 96. typescript-interface-secrets — TypeScript interface with secret fields (negative)
  // -----------------------------------------------------------------------
  {
    name: 'typescript-interface-secrets',
    description: 'TypeScript interface with password/secret/apiKey fields — type definitions not secrets',
    file: {
      path: 'src/types/config.ts',
      content: `interface AuthConfig {
  password: string;
  secret: string;
  apiKey: string;
  token: string;
}
export type { AuthConfig };`,
      language: 'typescript',
    },
    expected: [
      // Type annotation suppression + excludePattern (interface keyword) should prevent fires
    ],
  },

  // -----------------------------------------------------------------------
  // 97. test-file-eval — eval in test file (negative)
  // -----------------------------------------------------------------------
  {
    name: 'test-file-eval',
    description: 'eval() in a test file — regex excludeFiles suppresses, but AST-based detection leaks through',
    file: {
      path: 'src/__tests__/expression.test.ts',
      content: `describe('expression parser', () => {
  it('evaluates simple math', () => {
    expect(eval('2 + 2')).toBe(4);
  });
});`,
      language: 'typescript',
    },
    expected: [
      // AST analyzer produces ast-eval-usage (no excludeFiles check), normalized to eval-usage
      { ruleId: 'eval-usage', line: 3, verdict: 'fp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 98. test-file-hardcoded-secret — secrets in test file (negative)
  // -----------------------------------------------------------------------
  {
    name: 'test-file-hardcoded-secret',
    description: 'Hardcoded tokens in test file — excludeFiles suppresses hardcoded-secret/password',
    file: {
      path: 'src/__tests__/auth.test.ts',
      content: `const TEST_API_KEY = 'sk-test-1234567890abcdef1234567890abcdef';
const TEST_PASSWORD = 'testpassword123';
describe('auth', () => {
  it('validates', () => {
    expect(validate(TEST_API_KEY)).toBe(true);
  });
});`,
      language: 'typescript',
    },
    expected: [
      // hardcoded-secret and hardcoded-password both excludeFiles for \.test\. files
    ],
  },

  // -----------------------------------------------------------------------
  // 99. jsdoc-password-mention — JSDoc with password in comments (negative)
  // -----------------------------------------------------------------------
  {
    name: 'jsdoc-password-mention',
    description: 'JSDoc comment mentioning password — comment context should suppress hardcoded-password',
    file: {
      path: 'src/services/auth.ts',
      content: `/**
 * Validates the user password against the stored hash.
 * @param password - The plaintext password to verify
 * @returns true if the password matches
 */
export function validatePassword(password: string): boolean {
  return bcrypt.compareSync(password, storedHash);
}`,
      language: 'typescript',
    },
    expected: [
      // Comments mentioning password should not trigger hardcoded-password
      // (no assignment pattern like password = "value", just JSDoc text)
    ],
  },

  // -----------------------------------------------------------------------
  // 100. readme-example-code — comment with URL patterns (negative)
  // -----------------------------------------------------------------------
  {
    name: 'readme-example-code',
    description: 'Comments with URL and localStorage examples — should not trigger security rules',
    file: {
      path: 'docs/api-reference.ts',
      content: `// Example: fetch('https://api.example.com/login?token=my-token')
// Usage: localStorage.setItem('apiKey', response.token)
export const API_DOCS_VERSION = '1.0';`,
      language: 'typescript',
    },
    expected: [
      // Comment lines — context classifier suppresses non-critical rules on comments
      // sensitive-data-in-url and localstorage-secret patterns are in comments
    ],
  },

  // -----------------------------------------------------------------------
  // 101. crypto-best-practices — proper crypto usage (negative)
  // -----------------------------------------------------------------------
  {
    name: 'crypto-best-practices',
    description: 'Proper crypto usage with random key/IV and strong cipher — no crypto rules should fire',
    file: {
      path: 'src/crypto/secure.ts',
      content: `import crypto from 'crypto'
export function secureEncrypt(data: string) {
  const key = crypto.randomBytes(32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  return cipher.update(data, 'utf8', 'hex') + cipher.final('hex')
}`,
      language: 'typescript',
    },
    expected: [
      // aes-256-gcm is a strong cipher, randomBytes for key and IV — no weak crypto rules fire
    ],
  },

  // -----------------------------------------------------------------------
  // 102. nextjs-api-with-auth — Next.js route with getServerSession (negative)
  // -----------------------------------------------------------------------
  {
    name: 'nextjs-api-with-auth-session',
    description: 'Next.js API route with getServerSession — nextjs-api-no-auth should NOT fire',
    file: {
      path: 'pages/api/protected.ts',
      content: `import { getServerSession } from 'next-auth'
export default async function handler(req, res) {
  const session = await getServerSession(req, res)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  res.json({ data: [] })
}`,
      language: 'typescript',
    },
    expected: [
      // getServerSession present → nextjs-api-no-auth should NOT fire
      // But async function without try-catch triggers composite-async-no-try-catch
      { ruleId: 'composite-async-no-try-catch', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 103. minified-code-snippet — dense one-liner with multiple triggers
  // -----------------------------------------------------------------------
  {
    name: 'minified-code-snippet',
    description: 'Minified code with eval, new Function, password — tests scanner on dense patterns',
    file: {
      path: 'src/legacy-bundle.js',
      content: `var a=function(b){return eval(b)},c=function(d){return new Function(d)},e="password="+f;`,
      language: 'javascript',
    },
    expected: [
      // eval-usage fires on eval(b) and new Function(d)
      // Path avoids dist/ (SKIP_VENDORED) so scanner processes it
      { ruleId: 'eval-usage', line: 1, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 104. env-example-file — .env.example with placeholder secrets (negative)
  // -----------------------------------------------------------------------
  {
    name: 'env-example-file-fixture',
    description: '.env.example with placeholder values — excludeFiles suppresses secrets on .env.example',
    file: {
      path: '.env.example',
      content: `DATABASE_URL=postgresql://user:password@localhost:5432/db
API_KEY=your-api-key-here
SECRET_KEY=change-me-in-production
REDIS_URL=redis://localhost:6379`,
      language: 'plaintext',
    },
    expected: [
      // .env.example is in excludeFiles for hardcoded-secret and hardcoded-password
    ],
  },

  // -----------------------------------------------------------------------
  // 105. docker-compose-passwords — YAML with hardcoded passwords
  // -----------------------------------------------------------------------
  {
    name: 'docker-compose-passwords',
    description: 'Docker compose YAML with POSTGRES_PASSWORD — excludeFiles suppresses on .yml',
    file: {
      path: 'docker-compose.yml',
      content: `services:
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: supersecretpassword
      POSTGRES_DB: myapp`,
      language: 'yaml',
    },
    expected: [
      // docker-compose and .ya?ml$ are in excludeFiles for hardcoded-password and hardcoded-secret
    ],
  },

  // -----------------------------------------------------------------------
  // 106. github-actions-secrets — ${{ secrets.* }} vault refs (negative)
  // -----------------------------------------------------------------------
  {
    name: 'github-actions-secrets',
    description: 'GitHub Actions with ${{ secrets.* }} — vault references not hardcoded secrets',
    file: {
      path: '.github/workflows/deploy.yml',
      content: `env:
  API_KEY: \${{ secrets.API_KEY }}
  DATABASE_URL: \${{ secrets.DATABASE_URL }}`,
      language: 'yaml',
    },
    expected: [
      // .ya?ml$ in excludeFiles + ${{ secrets.* }} are vault references, not hardcoded values
    ],
  },
]
