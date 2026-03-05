/**
 * Shareable URL — encode/decode repo and view state using path-based URLs.
 *
 * Canonical format: `/owner/repo?view=docs`
 * Legacy format:    `/?repo=https://github.com/owner/repo&view=docs`
 */

type ViewId = 'repo' | 'issues' | 'docs' | 'diagram' | 'code' | 'deps' | 'changelog' | 'git-history'

interface ShareableState {
  /** GitHub repository URL (e.g. "https://github.com/owner/repo") */
  repoUrl: string
  /** Active tab ID */
  view?: ViewId
}

/**
 * Extract owner and repo from a GitHub URL.
 * Returns `null` if the URL doesn't match `github.com/:owner/:repo`.
 */
function extractOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl)
    if (url.hostname !== 'github.com') return null
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[1] }
    }
  } catch {
    // Not a valid URL — try simple split on github.com/
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (match) {
      return { owner: match[1], repo: match[2] }
    }
  }
  return null
}

/**
 * Build a full shareable URL using path-based format.
 *
 * Example output: `https://mgithub.com/owner/repo?view=diagram`
 */
export function buildShareableUrl(state: ShareableState): string {
  const parsed = extractOwnerRepo(state.repoUrl)
  if (!parsed) {
    // Fallback to legacy query-param format if we can't parse the repo URL
    const url = new URL(window.location.origin + '/')
    url.searchParams.set('repo', state.repoUrl)
    if (state.view && state.view !== 'repo') {
      url.searchParams.set('view', state.view)
    }
    return url.toString()
  }

  const url = new URL(`/${parsed.owner}/${parsed.repo}`, window.location.origin)
  if (state.view && state.view !== 'repo') {
    url.searchParams.set('view', state.view)
  }
  return url.toString()
}

/**
 * Parse shareable state from the current URL.
 *
 * Priority:
 * 1. Path-based: `/owner/repo` → reconstruct GitHub URL
 * 2. Query-based (legacy): `?repo=https://github.com/owner/repo`
 *
 * Returns `null` if no repo info is found.
 */
export function parseShareableUrl(
  search: string = window.location.search,
  pathname: string = window.location.pathname,
): ShareableState | null {
  const params = new URLSearchParams(search)

  // 1. Try path-based format: /owner/repo
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 2) {
    const [owner, repo] = segments
    const view = params.get('view') as ViewId | null
    return {
      repoUrl: `https://github.com/${owner}/${repo}`,
      view: view ?? undefined,
    }
  }

  // 2. Fallback: legacy query-param format
  const repoUrl = params.get('repo')
  if (!repoUrl) return null

  const view = params.get('view') as ViewId | null
  return {
    repoUrl,
    view: view ?? undefined,
  }
}

/**
 * Update the browser URL bar without triggering navigation.
 * Uses `replaceState` to avoid cluttering history.
 */
export function updateUrlState(state: ShareableState): void {
  const url = buildShareableUrl(state)
  window.history.replaceState(null, '', url)
}

/**
 * Clear shareable params from the URL — navigate back to root.
 */
export function clearUrlState(): void {
  window.history.replaceState(null, '', window.location.origin + '/')
}
