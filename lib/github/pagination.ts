// GitHub REST list pagination (Link rel="next"), shared by the server fetchers
// and the client's direct PAT mode so both return identical lists.

/** GitHub's maximum page size for list endpoints. */
export const GITHUB_LIST_PAGE_SIZE = 100

/** Hard cap on pages followed for one list (10 × 100 = 1000 items). */
export const GITHUB_LIST_MAX_PAGES = 10

const GITHUB_API_ORIGIN = 'https://api.github.com'

export interface PaginatedList<T> {
  items: T[]
  /** True when GitHub still advertised more items than were collected. */
  truncated: boolean
}

export interface GitHubListPage<T> {
  items: T[]
  linkHeader: string | null
}

/**
 * Upstream pages a collected list took, for refunding rate-limit charges.
 * GitHub fills every page but the last, so this is exact for its responses.
 */
export function githubPagesFetched(itemCount: number, pageSize: number = GITHUB_LIST_PAGE_SIZE): number {
  return Math.min(GITHUB_LIST_MAX_PAGES, Math.max(1, Math.ceil(itemCount / pageSize)))
}

/** Extract the rel="next" URL from a GitHub `Link` header. */
export function getNextPageLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]*)"/)
    if (match && match[2].split(/\s+/).includes('next')) return match[1]
  }
  return null
}

function isGitHubApiUrl(url: string): boolean {
  try {
    return new URL(url).origin === GITHUB_API_ORIGIN
  } catch {
    return false
  }
}

/**
 * Follow GitHub `Link` pagination from `firstUrl`, stopping after `maxPages`.
 * Next links are only followed on api.github.com, since requests may carry
 * credentials. A list cut short by the cap or an unusable link is reported as
 * truncated so it never looks complete.
 */
export async function collectGitHubPages<T>(
  firstUrl: string,
  fetchPage: (url: string) => Promise<GitHubListPage<T>>,
  maxPages: number = GITHUB_LIST_MAX_PAGES,
): Promise<PaginatedList<T>> {
  const items: T[] = []
  let url = firstUrl
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(url)
    items.push(...result.items)
    const next = getNextPageLink(result.linkHeader)
    if (next === null) return { items, truncated: false }
    if (!isGitHubApiUrl(next)) return { items, truncated: true }
    url = next
  }
  return { items, truncated: true }
}
