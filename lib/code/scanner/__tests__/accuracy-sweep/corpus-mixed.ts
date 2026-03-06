// Category C: Mixed Code — files 16-20
// Files with a mix of good and bad patterns, or edge cases for FP testing.

import type { CorpusEntry } from './corpus-realworld'

// 16. Legacy Express Middleware — console.log, TODO, but no security issues
const legacyMiddleware: CorpusEntry = {
  id: 'legacy-middleware-mixed',
  name: 'Legacy Express middleware with quality issues only',
  description: 'Express middleware with console.log, TODO comments, and var usage — but no security vulnerabilities.',
  category: 'mixed',
  file: {
    path: 'server/middleware/legacy-logger.ts',
    language: 'typescript',
    content: `import { Request, Response, NextFunction } from 'express'

// TODO: Replace this middleware with a proper logging library like winston or pino.
// TODO(team): Add request correlation IDs for distributed tracing.

var requestCount = 0

export function legacyRequestLogger(req: Request, res: Response, next: NextFunction) {
  var startTime = Date.now()
  requestCount++

  console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.path} - Request #\${requestCount}\`)

  const originalEnd = res.end
  res.end = function (...args: any[]) {
    var duration = Date.now() - startTime
    console.log(
      \`[\${new Date().toISOString()}] \${req.method} \${req.path} \${res.statusCode} - \${duration}ms\`
    )
    // FIXME: this is leaking memory because we never clear the request count
    return originalEnd.apply(res, args)
  } as any

  next()
}

export function legacyErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.log('Error occurred:', err.message)
  // TODO: Send error to monitoring service instead of just logging
  res.status(err.status || 500).json({ error: 'Internal server error' })
}

export function getRequestCount(): number {
  return requestCount
}
`,
  },
  expected: [
    { ruleId: 'console-log', line: 12, verdict: 'tp' },
    { ruleId: 'console-log', line: 17, verdict: 'tp' },
    { ruleId: 'console-log', line: 27, verdict: 'tp' },
    { ruleId: 'todo-fixme', line: 3, verdict: 'tp' },
    { ruleId: 'todo-fixme', line: 4, verdict: 'tp' },
    { ruleId: 'todo-fixme', line: 20, verdict: 'tp' },
    { ruleId: 'todo-fixme', line: 28, verdict: 'tp' },
    { ruleId: 'var-usage', line: 6, verdict: 'tp' },
    { ruleId: 'var-usage', line: 9, verdict: 'tp' },
    { ruleId: 'var-usage', line: 15, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 10, expectedClean: false },
}

// 17. React Component with DOMPurify — should NOT fire dangerouslySetInnerHTML
const reactWithSanitizer: CorpusEntry = {
  id: 'react-sanitized-mixed',
  name: 'React component using dangerouslySetInnerHTML with DOMPurify',
  description: 'React component using dangerouslySetInnerHTML but sanitizing with DOMPurify — scanner should not flag.',
  category: 'mixed',
  file: {
    path: 'components/content/rich-text.tsx',
    language: 'typescriptreact',
    content: `'use client'

import React, { useMemo } from 'react'
import DOMPurify from 'dompurify'

interface RichTextProps {
  html: string
  className?: string
  allowedTags?: string[]
}

export function RichText({ html, className, allowedTags }: RichTextProps) {
  const sanitizedHtml = useMemo(() => {
    const config: DOMPurify.Config = {
      ALLOWED_TAGS: allowedTags || ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
      ALLOWED_ATTR: ['href', 'target', 'rel'],
      ADD_ATTR: ['target'],
    }
    return DOMPurify.sanitize(html, config)
  }, [html, allowedTags])

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  )
}

export function PlainText({ content }: { content: string }) {
  return <p>{content}</p>
}
`,
  },
  expected: [],
  groundTruth: { expectedVulnCount: 0, expectedClean: true },
}

// 18. CLI Tool with eval — intentional eval in REPL context
const cliToolWithEval: CorpusEntry = {
  id: 'cli-eval-mixed',
  name: 'CLI REPL tool with eval',
  description: 'CLI tool with an interactive REPL that uses eval() — true positive, eval is dangerous even in CLIs.',
  category: 'mixed',
  file: {
    path: 'tools/repl.ts',
    language: 'typescript',
    content: `#!/usr/bin/env node

import readline from 'readline'
import fs from 'fs'
import path from 'path'

const HISTORY_FILE = path.join(process.env.HOME || '~', '.repl_history')

function loadHistory(): string[] {
  try {
    return fs.readFileSync(HISTORY_FILE, 'utf-8').split('\\n').filter(Boolean)
  } catch {
    return []
  }
}

function saveHistory(history: string[]): void {
  fs.writeFileSync(HISTORY_FILE, history.join('\\n'))
}

const context: Record<string, unknown> = {
  math: Math,
  JSON,
  Date,
}

async function startRepl(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
    history: loadHistory(),
  })

  console.log('Interactive REPL. Type .exit to quit, .help for commands.')

  rl.prompt()

  rl.on('line', (line: string) => {
    const input = line.trim()

    if (input === '.exit') {
      rl.close()
      return
    }

    if (input === '.help') {
      console.log('Commands: .exit, .help, .clear, .vars')
      rl.prompt()
      return
    }

    if (input === '.clear') {
      console.clear()
      rl.prompt()
      return
    }

    if (input === '.vars') {
      console.log(Object.keys(context).join(', '))
      rl.prompt()
      return
    }

    if (!input) {
      rl.prompt()
      return
    }

    try {
      const result = eval(input)
      if (result !== undefined) {
        console.log(result)
      }
    } catch (err: any) {
      console.error(\`Error: \${err.message}\`)
    }

    rl.prompt()
  })

  rl.on('close', () => {
    saveHistory(rl.history || [])
    process.exit(0)
  })
}

startRepl()
`,
  },
  expected: [
    { ruleId: 'eval-usage', line: 69, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 1, expectedClean: false },
}

// 19. Config Module — all secrets from env, nothing hardcoded
const configModule: CorpusEntry = {
  id: 'config-env-mixed',
  name: 'Config module with all secrets from environment',
  description: 'Config module that loads all sensitive values from environment variables — should be clean.',
  category: 'mixed',
  file: {
    path: 'lib/config/app-config.ts',
    language: 'typescript',
    content: `function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(\`Missing required environment variable: \${key}\`)
  }
  return value
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue
}

export const config = {
  env: optionalEnv('NODE_ENV', 'development'),
  port: parseInt(optionalEnv('PORT', '3000'), 10),

  database: {
    url: requireEnv('DATABASE_URL'),
    poolSize: parseInt(optionalEnv('DB_POOL_SIZE', '10'), 10),
    ssl: optionalEnv('DB_SSL', 'true') === 'true',
  },

  redis: {
    url: requireEnv('REDIS_URL'),
    keyPrefix: optionalEnv('REDIS_PREFIX', 'app:'),
  },

  auth: {
    jwtSecret: requireEnv('JWT_SECRET'),
    sessionSecret: requireEnv('SESSION_SECRET'),
    tokenExpiry: optionalEnv('TOKEN_EXPIRY', '1h'),
    refreshExpiry: optionalEnv('REFRESH_EXPIRY', '7d'),
  },

  email: {
    apiKey: requireEnv('SENDGRID_API_KEY'),
    fromAddress: optionalEnv('EMAIL_FROM', 'noreply@example.com'),
  },

  storage: {
    bucket: requireEnv('S3_BUCKET'),
    region: optionalEnv('AWS_REGION', 'us-east-1'),
    accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
  },

  features: {
    enableBetaFeatures: optionalEnv('ENABLE_BETA', 'false') === 'true',
    maxUploadSizeMb: parseInt(optionalEnv('MAX_UPLOAD_MB', '10'), 10),
  },
} as const
`,
  },
  expected: [],
  groundTruth: { expectedVulnCount: 0, expectedClean: true },
}

// 20. TypeScript Types File — pure type definitions, no runtime code
const typesOnlyFile: CorpusEntry = {
  id: 'types-only-mixed',
  name: 'Pure TypeScript type definitions',
  description: 'File containing only type definitions and interfaces — zero runtime code, must be completely clean.',
  category: 'mixed',
  file: {
    path: 'types/api.ts',
    language: 'typescript',
    content: `export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  createdAt: Date
  updatedAt: Date
}

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface PaginationParams {
  page: number
  limit: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, string[]>
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: ApiError
}

export interface CreateUserRequest {
  email: string
  name: string
  password: string
  role?: UserRole
}

export interface UpdateUserRequest {
  name?: string
  email?: string
  role?: UserRole
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  token: string
  refreshToken: string
  expiresAt: number
  user: Omit<User, 'createdAt' | 'updatedAt'>
}

export interface RefreshTokenRequest {
  refreshToken: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RouteConfig {
  path: string
  method: HttpMethod
  auth: boolean
  rateLimit?: {
    windowMs: number
    maxRequests: number
  }
}
`,
  },
  expected: [],
  groundTruth: { expectedVulnCount: 0, expectedClean: true },
}

export const MIXED_CORPUS: CorpusEntry[] = [
  legacyMiddleware,
  reactWithSanitizer,
  cliToolWithEval,
  configModule,
  typesOnlyFile,
]
