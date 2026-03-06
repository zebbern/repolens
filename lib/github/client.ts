import type { GitHubRepo, RepoTree, GitHubTag, GitHubBranch, GitHubCommit, GitHubComparison } from "@/types/repository"
import type { BlameData, CommitDetail } from "@/types/git-history"
import {
  getCached,
  getStale,
  setCache,
  clearCache as clearMemoryCache,
  invalidatePattern,
} from "@/lib/cache/memory-cache"

// ---------------------------------------------------------------------------
// TTL constants (milliseconds)
// ---------------------------------------------------------------------------

const CACHE_TTL_RATE_LIMIT  = 30_000   // 30 seconds
const CACHE_TTL_REPO_META  = 300_000  // 5 minutes
const CACHE_TTL_TREE       = 600_000  // 10 minutes
const CACHE_TTL_FILE       = 600_000  // 10 minutes
const CACHE_TTL_TAGS       = 600_000  // 10 minutes
const CACHE_TTL_BRANCHES   = 300_000  // 5 minutes
const CACHE_TTL_COMMITS    = 300_000  // 5 minutes
const CACHE_TTL_COMPARE    = 600_000  // 10 minutes
const CACHE_TTL_BLAME         = 600_000  // 10 minutes
const CACHE_TTL_COMMIT_DETAIL = 600_000  // 10 minutes

// ---------------------------------------------------------------------------
// PAT management — allows the React provider to inject a token
// ---------------------------------------------------------------------------

let _githubPAT: string | null = null

export function setGitHubPAT(token: string | null): void {
  _githubPAT = token
}

export function getGitHubPAT(): string | null {
  return _githubPAT
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build headers for proxy requests, attaching the PAT when available. */
function buildProxyHeaders(): HeadersInit {
  const headers: HeadersInit = {}
  if (_githubPAT) {
    headers['X-GitHub-Token'] = _githubPAT
  }
  return headers
}

/**
 * Client-side fetcher that calls proxy API routes instead of GitHub directly.
 * The proxy routes handle authentication — the access token never reaches the browser.
 */
async function proxyFetch<T>(url: string): Promise<T> {
  if (!url.startsWith('/')) {
    throw new Error('proxyFetch only accepts relative URLs')
  }
  const response = await fetch(url, { headers: buildProxyHeaders() })

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
 * SWR-style cached fetch: returns fresh data from cache, serves stale data
 * while revalidating in the background, or fetches on a complete miss.
 */
async function cachedProxyFetch<T>(
  cacheKey: string,
  url: string,
  ttl: number,
): Promise<T> {
  // 1. Fresh cache hit — return immediately
  const fresh = getCached<T>(cacheKey)
  if (fresh !== null) return fresh

  // 2. Stale hit — return stale data, revalidate in background
  const stale = getStale<T>(cacheKey)
  if (stale !== null && stale.isStale) {
    // Fire-and-forget background revalidation
    proxyFetch<T>(url)
      .then((data) => setCache(cacheKey, data, ttl))
      .catch((err) => {
        console.warn('[cachedProxyFetch] Background revalidation failed:', cacheKey, err)
      })
    return stale.data
  }

  // 3. Cache miss — fetch, cache, return
  const data = await proxyFetch<T>(url)
  setCache(cacheKey, data, ttl)
  return data
}

// ---------------------------------------------------------------------------
// Public API — proxy fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch repository metadata through the proxy
 */
export async function fetchRepoViaProxy(
  owner: string,
  name: string,
): Promise<GitHubRepo> {
  const key = `repo:${owner}/${name}`
  const url = `/api/github/repo?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`
  return cachedProxyFetch<GitHubRepo>(key, url, CACHE_TTL_REPO_META)
}

/**
 * Fetch repository file tree through the proxy
 */
export async function fetchTreeViaProxy(
  owner: string,
  name: string,
  sha: string = "HEAD",
): Promise<RepoTree> {
  const key = `tree:${owner}/${name}:${sha}`
  const url = `/api/github/tree?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}&sha=${encodeURIComponent(sha)}`
  return cachedProxyFetch<RepoTree>(key, url, CACHE_TTL_TREE)
}

/**
 * Fetch file content through the proxy
 */
export async function fetchFileViaProxy(
  owner: string,
  name: string,
  branch: string,
  path: string,
): Promise<string> {
  const key = `file:${owner}/${name}:${branch}:${path}`
  const url = `/api/github/file?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`

  // File content returns { content: string } — unwrap after caching the raw response
  const data = await cachedProxyFetch<{ content: string }>(key, url, CACHE_TTL_FILE)
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
  const key = 'rate-limit'
  const url = '/api/github/rate-limit'
  return cachedProxyFetch(key, url, CACHE_TTL_RATE_LIMIT)
}

// ---------------------------------------------------------------------------
// Tags, branches, commits, compare — proxy fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch repository tags through the proxy.
 */
export async function fetchTagsViaProxy(
  owner: string,
  name: string,
  perPage?: number,
): Promise<GitHubTag[]> {
  const key = `tags:${owner}/${name}`
  const params = new URLSearchParams({
    owner,
    name,
  })
  if (perPage !== undefined) params.set('per_page', String(perPage))
  const url = `/api/github/tags?${params.toString()}`
  return cachedProxyFetch<GitHubTag[]>(key, url, CACHE_TTL_TAGS)
}

/**
 * Fetch repository branches through the proxy.
 */
export async function fetchBranchesViaProxy(
  owner: string,
  name: string,
  perPage?: number,
): Promise<GitHubBranch[]> {
  const key = `branches:${owner}/${name}`
  const params = new URLSearchParams({
    owner,
    name,
  })
  if (perPage !== undefined) params.set('per_page', String(perPage))
  const url = `/api/github/branches?${params.toString()}`
  return cachedProxyFetch<GitHubBranch[]>(key, url, CACHE_TTL_BRANCHES)
}

/**
 * Fetch repository commits through the proxy.
 */
export async function fetchCommitsViaProxy(
  owner: string,
  name: string,
  opts?: { sha?: string; since?: string; until?: string; perPage?: number },
): Promise<GitHubCommit[]> {
  const params = new URLSearchParams({ owner, name })
  if (opts?.sha) params.set('sha', opts.sha)
  if (opts?.since) params.set('since', opts.since)
  if (opts?.until) params.set('until', opts.until)
  if (opts?.perPage !== undefined) params.set('per_page', String(opts.perPage))

  const key = `commits:${owner}/${name}:${params.toString()}`
  const url = `/api/github/commits?${params.toString()}`
  return cachedProxyFetch<GitHubCommit[]>(key, url, CACHE_TTL_COMMITS)
}

/**
 * Fetch comparison between two refs through the proxy.
 */
export async function fetchCompareViaProxy(
  owner: string,
  name: string,
  base: string,
  head: string,
): Promise<GitHubComparison> {
  const key = `compare:${owner}/${name}:${base}...${head}`
  const params = new URLSearchParams({ owner, name, base, head })
  const url = `/api/github/compare?${params.toString()}`
  return cachedProxyFetch<GitHubComparison>(key, url, CACHE_TTL_COMPARE)
}

// ---------------------------------------------------------------------------
// Git History & Blame — proxy fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch blame data through the proxy (POST — requires auth).
 * Uses manual cache + POST since cachedProxyFetch is GET-only.
 */
export async function fetchBlameViaProxy(
  owner: string,
  name: string,
  ref: string,
  path: string,
): Promise<BlameData> {
  const safePath = path.replace(/:/g, '%3A')
  const key = `blame:${owner}/${name}:${ref}:${safePath}`

  // Check fresh cache
  const fresh = getCached<BlameData>(key)
  if (fresh !== null) return fresh

  // Check stale cache (SWR)
  const stale = getStale<BlameData>(key)
  if (stale !== null && stale.isStale) {
    // Fire-and-forget background revalidation
    fetchBlameFromApi(owner, name, ref, path)
      .then((data) => setCache(key, data, CACHE_TTL_BLAME))
      .catch((err) => {
        console.warn('[fetchBlameViaProxy] Background revalidation failed:', key, err)
      })
    return stale.data
  }

  // Cache miss — fetch, cache, return
  const data = await fetchBlameFromApi(owner, name, ref, path)
  setCache(key, data, CACHE_TTL_BLAME)
  return data
}

/** Internal helper: POST to /api/github/blame and parse response. */
async function fetchBlameFromApi(
  owner: string,
  name: string,
  ref: string,
  path: string,
): Promise<BlameData> {
  const headers: HeadersInit = { 'Content-Type': 'application/json', ...buildProxyHeaders() }
  const response = await fetch('/api/github/blame', {
    method: 'POST',
    headers,
    body: JSON.stringify({ owner, name, ref, path }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const parsed = body as { error?: string | { message?: string } }
    const message =
      typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error?.message ?? `Request failed: ${response.statusText}`
    throw new Error(message)
  }

  return response.json() as Promise<BlameData>
}

/**
 * Fetch commits for a specific file through the proxy.
 */
export async function fetchFileCommitsViaProxy(
  owner: string,
  name: string,
  path: string,
  opts?: { perPage?: number },
): Promise<GitHubCommit[]> {
  const params = new URLSearchParams({ owner, name, path })
  if (opts?.perPage !== undefined) params.set('per_page', String(opts.perPage))

  const key = `file-commits:${owner}/${name}:${path}:${params.toString()}`
  const url = `/api/github/commits?${params.toString()}`
  return cachedProxyFetch<GitHubCommit[]>(key, url, CACHE_TTL_COMMITS)
}

/**
 * Fetch detailed commit information through the proxy.
 */
export async function fetchCommitDetailViaProxy(
  owner: string,
  name: string,
  sha: string,
): Promise<CommitDetail> {
  const key = `commit-detail:${owner}/${name}:${sha}`
  const url = `/api/github/commit/${encodeURIComponent(sha)}?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`
  return cachedProxyFetch<CommitDetail>(key, url, CACHE_TTL_COMMIT_DETAIL)
}

// ---------------------------------------------------------------------------
// Cache management — exported for manual invalidation
// ---------------------------------------------------------------------------

/** Clear all cached GitHub API responses. */
export function clearGitHubCache(): void {
  clearMemoryCache()
}

/** Invalidate all cached data for a specific repository. */
export function invalidateRepoCache(owner: string, repo: string): void {
  const prefix = `repo:${owner}/${repo}`
  invalidatePattern(prefix)
  invalidatePattern(`tree:${owner}/${repo}`)
  invalidatePattern(`file:${owner}/${repo}`)
  invalidatePattern(`tags:${owner}/${repo}`)
  invalidatePattern(`branches:${owner}/${repo}`)
  invalidatePattern(`commits:${owner}/${repo}`)
  invalidatePattern(`compare:${owner}/${repo}`)
  invalidatePattern(`blame:${owner}/${repo}`)
  invalidatePattern(`commit-detail:${owner}/${repo}`)
  invalidatePattern(`file-commits:${owner}/${repo}`)
}
