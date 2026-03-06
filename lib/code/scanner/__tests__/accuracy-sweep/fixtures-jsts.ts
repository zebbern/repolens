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
      // eval-usage is security+critical — fires even on test files despite excludeFiles
      { ruleId: 'eval-usage', line: 6, verdict: 'fp' },
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
      { ruleId: 'express-no-rate-limit', line: 13, verdict: 'tp' },
      { ruleId: 'express-body-parser-no-limit', line: 6, verdict: 'tp' },
      { ruleId: 'composite-csrf-missing-express', line: 13, verdict: 'tp' },
      { ruleId: 'express-no-rate-limit', line: 5, verdict: 'fp' },
      { ruleId: 'express-no-rate-limit', line: 6, verdict: 'fp' },
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
      // nextjs-api-no-auth fires because per-line regex can't see getServerSession on a different line
      { ruleId: 'nextjs-api-no-auth', line: 4, verdict: 'fp' },
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
      { ruleId: 'express-no-rate-limit', line: 4, verdict: 'fp' },
      { ruleId: 'express-no-rate-limit', line: 5, verdict: 'fp' },
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
      { ruleId: 'express-no-rate-limit', line: 5, verdict: 'fp' },
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
      { ruleId: 'nextjs-api-no-auth', line: 1, verdict: 'fp' },
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
]
