import type { NextRequest } from 'next/server'

import { getAccessToken } from '@/lib/auth/token'

const PRIVATE_CACHE_CONTROL = 'private, no-store, max-age=0'
const PUBLIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate'
const GITHUB_CACHE_VARY = 'X-GitHub-Token, Cookie'

type GitHubGetHandler<TArgs extends unknown[]> = (
  request: NextRequest,
  accessToken: string | undefined,
  ...args: TArgs
) => Promise<Response>

/**
 * Cache policy for GitHub proxy responses.
 *
 * Any resolved PAT or OAuth access token makes the upstream response private.
 */
export function getGitHubCacheHeaders(
  accessToken: string | undefined,
  cdnCacheControl?: string,
): Record<string, string> {
  if (accessToken) {
    return {
      'Cache-Control': PRIVATE_CACHE_CONTROL,
      'CDN-Cache-Control': 'no-store',
      Vary: GITHUB_CACHE_VARY,
    }
  }

  return {
    'Cache-Control': PUBLIC_CACHE_CONTROL,
    ...(cdnCacheControl ? { 'CDN-Cache-Control': cdnCacheControl } : {}),
    'Vercel-Cache-Tag': 'github-public',
    Vary: GITHUB_CACHE_VARY,
  }
}

/**
 * Resolves authentication before a route executes, then applies the matching
 * cache policy to every response branch the route returns.
 */
export function withGitHubCachePolicy<TArgs extends unknown[]>(
  handler: GitHubGetHandler<TArgs>,
  cdnCacheControl?: string,
) {
  return async (request: NextRequest, ...args: TArgs): Promise<Response> => {
    const accessToken = await getAccessToken(request)
    const response = await handler(request, accessToken, ...args)

    for (const [name, value] of Object.entries(
      getGitHubCacheHeaders(accessToken, cdnCacheControl),
    )) {
      if (name === 'Vary') {
        const existingVary = response.headers.get(name)
        response.headers.set(name, existingVary ? `${existingVary}, ${value}` : value)
        continue
      }

      response.headers.set(name, value)
    }

    return response
  }
}
