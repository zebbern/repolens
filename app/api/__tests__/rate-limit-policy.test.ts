import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTE_BUCKETS = {
  'app/api/changelog/generate/route.ts': '/api/changelog/generate',
  'app/api/chat/route.ts': '/api/chat',
  'app/api/docs/generate/route.ts': '/api/docs/generate',
  'app/api/deps/cve/route.ts': '/api/deps/cve',
  'app/api/deps/route.ts': '/api/deps',
  'app/api/github/blame/route.ts': '/api/github/blame',
  'app/api/github/branches/route.ts': '/api/github/branches',
  'app/api/github/commit/[sha]/route.ts': '/api/github/commit/[sha]',
  'app/api/github/commits/route.ts': '/api/github/commits',
  'app/api/github/compare/route.ts': '/api/github/compare',
  'app/api/github/file/route.ts': '/api/github/file',
  'app/api/github/languages/route.ts': '/api/github/languages',
  'app/api/github/pulls/[number]/comments/route.ts': '/api/github/pulls/[number]/comments',
  'app/api/github/pulls/[number]/files/route.ts': '/api/github/pulls/[number]/files',
  'app/api/github/pulls/[number]/route.ts': '/api/github/pulls/[number]',
  'app/api/github/pulls/route.ts': '/api/github/pulls',
  'app/api/github/rate-limit/route.ts': '/api/github/rate-limit',
  'app/api/github/refs/route.ts': '/api/github/refs',
  'app/api/github/repo/route.ts': '/api/github/repo',
  'app/api/github/tags/route.ts': '/api/github/tags',
  'app/api/github/tree/route.ts': '/api/github/tree',
  'app/api/github/validate-token/route.ts': '/api/github/validate-token',
  'app/api/github/zipball/route.ts': '/api/github/zipball',
  'app/api/inline-actions/route.ts': '/api/inline-actions',
  'app/api/issues/validate/route.ts': '/api/issues/validate',
  'app/api/models/anthropic/route.ts': '/api/models/anthropic',
  'app/api/models/google/route.ts': '/api/models/google',
  'app/api/models/openai/route.ts': '/api/models/openai',
  'app/api/models/openrouter/route.ts': '/api/models/openrouter',
  'app/api/skills/route.ts': '/api/skills',
} as const

const NEXTAUTH_ROUTE = 'app/api/auth/[...nextauth]/route.ts'

function escapeRouteTemplate(bucket: string): string {
  return bucket.replaceAll('[', '\\[').replaceAll(']', '\\]')
}

function findApiRoutes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findApiRoutes(path)
    if (entry.name !== 'route.ts') return []
    return [relative(process.cwd(), path).replaceAll('\\', '/')]
  })
}

describe('rate-limit route policies', () => {
  it('gives every non-NextAuth API route an explicit stable template bucket', () => {
    const routes = findApiRoutes(join(process.cwd(), 'app', 'api'))

    expect(routes).toContain(NEXTAUTH_ROUTE)
    expect(readFileSync(join(process.cwd(), NEXTAUTH_ROUTE), 'utf8')).not.toContain('applyRateLimit(')
    expect(routes.filter((route) => route !== NEXTAUTH_ROUTE).sort()).toEqual(Object.keys(ROUTE_BUCKETS).sort())

    for (const [route, bucket] of Object.entries(ROUTE_BUCKETS)) {
      const source = readFileSync(join(process.cwd(), route), 'utf8')
      expect(source).toMatch(new RegExp(`applyRateLimit\\([^,]+,\\s*\\{\\s*bucket: '${escapeRouteTemplate(bucket)}'`))
    }
  })
})
