import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { getGitHubCacheHeaders } from './github-cache'

const GITHUB_ROUTES_DIRECTORY = path.join(process.cwd(), 'app', 'api', 'github')

function findRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findRouteFiles(entryPath)
    return entry.name === 'route.ts' ? [entryPath] : []
  })
}

describe('getGitHubCacheHeaders', () => {
  it('prevents browser and CDN caching for authenticated responses', () => {
    expect(getGitHubCacheHeaders('gho_access_token', 's-maxage=300, stale-while-revalidate=60')).toEqual({
      'Cache-Control': 'private, no-store, max-age=0',
      'CDN-Cache-Control': 'no-store',
    })
  })

  it('keeps public responses revalidating in browsers while retaining their CDN policy', () => {
    expect(getGitHubCacheHeaders(undefined, 's-maxage=300, stale-while-revalidate=60')).toEqual({
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'CDN-Cache-Control': 's-maxage=300, stale-while-revalidate=60',
      'Vercel-Cache-Tag': 'github-public',
    })
  })

  it('is used by every token-aware GitHub GET handler', () => {
    const tokenAwareGetRoutes = findRouteFiles(GITHUB_ROUTES_DIRECTORY)
      .filter((routePath) => {
        const source = readFileSync(routePath, 'utf8')
        return source.includes('export async function GET') && source.includes('getAccessToken(request)')
      })

    expect(tokenAwareGetRoutes).not.toHaveLength(0)
    for (const routePath of tokenAwareGetRoutes) {
      const source = readFileSync(routePath, 'utf8')
      expect(
        source,
        `${path.relative(process.cwd(), routePath)} must use the shared GitHub cache policy`,
      ).toMatch(/headers:\s*getGitHubCacheHeaders\(/)
    }
  })
})
