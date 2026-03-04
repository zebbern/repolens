import type { GitHubRepo, RepoTree } from "@/types/repository"

/**
 * Client-side fetcher that calls proxy API routes instead of GitHub directly.
 * The proxy routes handle authentication — the access token never reaches the browser.
 */

async function proxyFetch<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const parsed = body as { error?: string | { message?: string } }
    const message =
      typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error?.message ?? `Request failed: ${response.statusText}`
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

/**
 * Fetch repository metadata through the proxy
 */
export async function fetchRepoViaProxy(
  owner: string,
  name: string
): Promise<GitHubRepo> {
  return proxyFetch<GitHubRepo>(
    `/api/github/repo?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`
  )
}

/**
 * Fetch repository file tree through the proxy
 */
export async function fetchTreeViaProxy(
  owner: string,
  name: string,
  sha: string = "HEAD"
): Promise<RepoTree> {
  return proxyFetch<RepoTree>(
    `/api/github/tree?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}&sha=${encodeURIComponent(sha)}`
  )
}

/**
 * Fetch file content through the proxy
 */
export async function fetchFileViaProxy(
  owner: string,
  name: string,
  branch: string,
  path: string
): Promise<string> {
  const data = await proxyFetch<{ content: string }>(
    `/api/github/file?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`
  )
  return data.content
}

/**
 * Fetch rate limit status through the proxy
 */
export async function fetchRateLimitViaProxy(): Promise<{
  limit: number
  remaining: number
  reset: number
  authenticated: boolean
}> {
  return proxyFetch(
    "/api/github/rate-limit"
  )
}
