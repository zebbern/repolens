import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAccessToken = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

import { getGitHubCacheHeaders, withGitHubCachePolicy } from './github-cache'

const GITHUB_ROUTES_DIRECTORY = path.join(process.cwd(), 'app', 'api', 'github')

function findRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findRouteFiles(entryPath)
    return entry.name === 'route.ts' ? [entryPath] : []
  })
}

describe('getGitHubCacheHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prevents browser and CDN caching for authenticated responses', () => {
    expect(getGitHubCacheHeaders('gho_access_token', 's-maxage=300, stale-while-revalidate=60')).toEqual({
      'Cache-Control': 'private, no-store, max-age=0',
      'CDN-Cache-Control': 'no-store',
      Vary: 'X-GitHub-Token, Cookie',
    })
  })

  it('keeps public responses revalidating in browsers while retaining their CDN policy', () => {
    expect(getGitHubCacheHeaders(undefined, 's-maxage=300, stale-while-revalidate=60')).toEqual({
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'CDN-Cache-Control': 's-maxage=300, stale-while-revalidate=60',
      'Vercel-Cache-Tag': 'github-public',
      Vary: 'X-GitHub-Token, Cookie',
    })
  })

  it.each([400, 403, 404, 429, 500])(
    'applies authenticated no-store policy to a %i response branch',
    async (status) => {
      mockGetAccessToken.mockResolvedValue('gho_access_token')
      const GET = withGitHubCachePolicy(async () => new Response(null, { status }))

      const response = await GET({} as Parameters<typeof GET>[0])

      expect(response.status).toBe(status)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
      expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
      expect(response.headers.get('Vary')).toBe('X-GitHub-Token, Cookie')
    },
  )

  it('preserves an existing Vary value while adding authentication cache keys', async () => {
    mockGetAccessToken.mockResolvedValue(undefined)
    const GET = withGitHubCachePolicy(async () => new Response(null, {
      headers: { Vary: 'Accept-Encoding' },
    }))

    const response = await GET({} as Parameters<typeof GET>[0])

    expect(response.headers.get('Vary')).toBe('Accept-Encoding, X-GitHub-Token, Cookie')
  })

  it('handles access-token resolution failures without entering the route handler', async () => {
    mockGetAccessToken.mockRejectedValue(new Error('AUTH_SECRET is not configured'))
    const handler = vi.fn(async () => Response.json({ unexpected: true }))
    const GET = withGitHubCachePolicy(handler)

    const response = await GET({} as Parameters<typeof GET>[0])

    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'AUTH_RESOLUTION_ERROR',
        message: 'Unable to resolve GitHub authentication',
      },
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(response.headers.get('Vary')).toBe('X-GitHub-Token, Cookie')
  })

  it('uses the shared wrapper for every token-aware GitHub GET handler', () => {
    const tokenAwareGetRoutes = findRouteFiles(GITHUB_ROUTES_DIRECTORY)
      .filter((routePath) => /export (?:const GET|async function GET)/.test(readFileSync(routePath, 'utf8')))

    expect(tokenAwareGetRoutes).not.toHaveLength(0)
    for (const routePath of tokenAwareGetRoutes) {
      const source = readFileSync(routePath, 'utf8')
      expect(
        source,
        `${path.relative(process.cwd(), routePath)} must use the shared GitHub cache wrapper`,
      ).toContain('withGitHubCachePolicy')
    }
  })
})
