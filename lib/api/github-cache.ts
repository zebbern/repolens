import type { NextRequest } from 'next/server'

import { apiError } from '@/lib/api/error'
import { getAccessToken } from '@/lib/auth/token'

const PRIVATE_CACHE_CONTROL = 'private, no-store, max-age=0'
const PUBLIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate'
const GITHUB_CACHE_VARY = 'X-GitHub-Token, Cookie'

type GitHubGetHandler<TArgs extends unknown[]> = (
  request: NextRequest,
  accessToken: string | undefined,
  ...args: TArgs
) => Promise<Response>

function getPrivateGitHubCacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': PRIVATE_CACHE_CONTROL,
    'CDN-Cache-Control': 'no-store',
    Vary: GITHUB_CACHE_VARY,
  }
}

function applyGitHubCacheHeaders(
  response: Response,
  cacheHeaders: Record<string, string>,
): Response {
  for (const [name, value] of Object.entries(cacheHeaders)) {
    if (name === 'Vary') {
      const existingVary = response.headers.get(name)
      response.headers.set(name, existingVary ? `${existingVary}, ${value}` : value)
      continue
    }

    response.headers.set(name, value)
  }

  return response
}

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
    return getPrivateGitHubCacheHeaders()
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
    let accessToken: string | undefined
    try {
      accessToken = await getAccessToken(request)
    } catch {
      return applyGitHubCacheHeaders(
        apiError('AUTH_RESOLUTION_ERROR', 'Unable to resolve GitHub authentication', 500),
        getPrivateGitHubCacheHeaders(),
      )
    }

    const response = await handler(request, accessToken, ...args)

    return applyGitHubCacheHeaders(
      response,
      getGitHubCacheHeaders(accessToken, cdnCacheControl),
    )
  }
}
