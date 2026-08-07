const PRIVATE_CACHE_CONTROL = 'private, no-store, max-age=0'
const PUBLIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

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
    }
  }

  return {
    'Cache-Control': PUBLIC_CACHE_CONTROL,
    ...(cdnCacheControl ? { 'CDN-Cache-Control': cdnCacheControl } : {}),
    'Vercel-Cache-Tag': 'github-public',
  }
}
