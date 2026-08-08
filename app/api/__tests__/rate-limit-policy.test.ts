import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTE_BUCKETS = {
  'app/api/changelog/generate/route.ts': '/api/changelog/generate',
  'app/api/chat/route.ts': '/api/chat',
  'app/api/docs/generate/route.ts': '/api/docs/generate',
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
  'app/api/skills/route.ts': '/api/skills',
} as const

function findRateLimitedRoutes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findRateLimitedRoutes(path)
    if (entry.name !== 'route.ts' || !readFileSync(path, 'utf8').includes('applyRateLimit(')) return []
    return [relative(process.cwd(), path).replaceAll('\\', '/')]
  })
}

describe('rate-limit route policies', () => {
  it('gives every rate-limited route an explicit stable template bucket', () => {
    const routes = findRateLimitedRoutes(join(process.cwd(), 'app', 'api'))

    expect(routes.sort()).toEqual(Object.keys(ROUTE_BUCKETS).sort())

    for (const [route, bucket] of Object.entries(ROUTE_BUCKETS)) {
      const source = readFileSync(join(process.cwd(), route), 'utf8')
      expect(source).toContain(`bucket: '${bucket}'`)
    }
  })
})
