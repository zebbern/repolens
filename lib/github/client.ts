import type { GitHubRepo, RepoTree, GitHubTag, GitHubBranch, GitHubCommit, GitHubComparison } from "@/types/repository"
import type { BlameData, CommitDetail, CommitFile } from "@/types/git-history"
import type { PRMetadata, PRFile, PRComment } from "@/types/pr-review"
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
const CACHE_TTL_PULLS         = 60_000   // 1 minute
const CACHE_TTL_LANGUAGES     = 600_000  // 10 minutes

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

// ---------------------------------------------------------------------------
// Direct GitHub API helpers (PAT mode — bypasses proxy routes)
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

/** Endpoint type identifier for URL mapping and response normalization. */
type ProxyEndpoint =
  | 'repo'
  | 'tree'
  | 'file'
  | 'tags'
  | 'branches'
  | 'commits'
  | 'compare'
  | 'commit'
  | 'rate-limit'

interface DirectUrlMapping {
  url: string
  endpoint: ProxyEndpoint
}

/**
 * Convert a proxy API path+params into a direct GitHub API URL.
 * Returns null for unrecognized paths (caller falls through to proxy).
 */
function mapProxyUrlToGitHubApi(proxyUrl: string): DirectUrlMapping | null {
  const parsed = new URL(proxyUrl, 'http://localhost')
  const pathname = parsed.pathname
  const params = parsed.searchParams
  const owner = params.get('owner') ?? ''
  const name = params.get('name') ?? ''
  const e = encodeURIComponent

  if (pathname === '/api/github/repo') {
    return { url: `${GITHUB_API_BASE}/repos/${e(owner)}/${e(name)}`, endpoint: 'repo' }
  }

  if (pathname === '/api/github/tree') {
    const sha = params.get('sha') ?? 'HEAD'
    return {
      url: `${GITHUB_API_BASE}/repos/${e(owner)}/${e(name)}/git/trees/${e(sha)}?recursive=1`,
      endpoint: 'tree',
    }
  }

  if (pathname === '/api/github/file') {
    const branch = params.get('branch') ?? ''
    const path = params.get('path') ?? ''
    return {
      url: `https://raw.githubusercontent.com/${e(owner)}/${e(name)}/${e(branch)}/${path.split('/').map(e).join('/')}`,
      endpoint: 'file',
    }
  }

  if (pathname === '/api/github/tags') {
    const qp = new URLSearchParams()
    const perPage = params.get('per_page')
    if (perPage) qp.set('per_page', perPage)
    const qs = qp.toString()
    return {
      url: `${GITHUB_API_BASE}/repos/${e(owner)}/${e(name)}/tags${qs ? `?${qs}` : ''}`,
      endpoint: 'tags',
    }
  }

  if (pathname === '/api/github/branches') {
    const qp = new URLSearchParams()
    const perPage = params.get('per_page')
    if (perPage) qp.set('per_page', perPage)
    const qs = qp.toString()
    return {
      url: `${GITHUB_API_BASE}/repos/${e(owner)}/${e(name)}/branches${qs ? `?${qs}` : ''}`,
      endpoint: 'branches',
    }
  }

  if (pathname === '/api/github/commits') {
    const qp = new URLSearchParams()
    for (const key of ['sha', 'since', 'until', 'per_page', 'path']) {
      const val = params.get(key)
      if (val) qp.set(key, val)
    }
    const qs = qp.toString()
    return {
      url: `${GITHUB_API_BASE}/repos/${e(owner)}/${e(name)}/commits${qs ? `?${qs}` : ''}`,
      endpoint: 'commits',
    }
  }

  if (pathname === '/api/github/compare') {
    const base = e(params.get('base') ?? '')
    const head = e(params.get('head') ?? '')
    return {
      url: `${GITHUB_API_BASE}/repos/${e(owner)}/${e(name)}/compare/${base}...${head}`,
      endpoint: 'compare',
    }
  }

  // /api/github/commit/{sha}?owner=X&name=Y
  const commitMatch = pathname.match(/^\/api\/github\/commit\/([a-f0-9]{4,40})$/i)
  if (commitMatch) {
    const sha = commitMatch[1]
    return {
      url: `${GITHUB_API_BASE}/repos/${e(owner)}/${e(name)}/commits/${sha}`,
      endpoint: 'commit',
    }
  }

  if (pathname === '/api/github/rate-limit') {
    return { url: `${GITHUB_API_BASE}/rate_limit`, endpoint: 'rate-limit' }
  }

  return null
}

/**
 * Fetch from the GitHub API directly with PAT authentication.
 * Handles JSON responses and common GitHub error codes.
 */
async function directFetch(url: string, pat: string, timeoutMs?: number): Promise<unknown> {
  const fetchOptions: RequestInit = {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${pat}`,
    },
    redirect: 'error',
  }
  if (timeoutMs) {
    fetchOptions.signal = AbortSignal.timeout(timeoutMs)
  }
  const response = await fetch(url, fetchOptions)

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const ghMessage = (body as { message?: string }).message
    if (response.status === 404) {
      throw new Error(ghMessage ?? 'Not found. Make sure the repository exists.')
    }
    if (response.status === 401) {
      throw new Error('Invalid or expired GitHub token. Check your PAT in Settings.')
    }
    if (response.status === 403) {
      throw new Error(ghMessage ?? 'Rate limit exceeded. Try again later.')
    }
    if (response.status === 422) {
      throw new Error(ghMessage ?? 'Invalid request.')
    }
    throw new Error(ghMessage ?? `Request failed: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Fetch file content from raw.githubusercontent.com with PAT auth.
 * Returns { content: string } to match the proxy response shape.
 */
async function directFetchRawFile(url: string, pat: string, timeoutMs?: number): Promise<{ content: string }> {
  const fetchOptions: RequestInit = {
    headers: { 'Authorization': `Bearer ${pat}` },
    redirect: 'error',
  }
  if (timeoutMs) {
    fetchOptions.signal = AbortSignal.timeout(timeoutMs)
  }
  const response = await fetch(url, fetchOptions)

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('File not found.')
    }
    throw new Error(`Failed to fetch file: ${response.statusText}`)
  }

  const content = await response.text()
  return { content }
}

// ---------------------------------------------------------------------------
// Response normalization — transform raw GitHub API data to match proxy shapes
// These mirror the transformations in lib/github/fetcher.ts.
// ---------------------------------------------------------------------------

// --- Raw GitHub REST API response shapes (only fields accessed by normalizers) ---

interface GitHubApiRepoResponse {
  owner: { login: string }
  name: string
  full_name: string
  description: string | null
  default_branch: string
  stargazers_count: number
  forks_count: number
  language: string | null
  topics?: string[]
  private: boolean
  html_url: string
  size?: number
  open_issues_count?: number
  pushed_at?: string
  license?: { spdx_id?: string } | null
}

interface GitHubApiTagResponse {
  name: string
  commit: { sha: string; url: string }
  tarball_url?: string
  zipball_url?: string
}

interface GitHubApiBranchResponse {
  name: string
  commit: { sha: string }
  protected?: boolean
}

interface GitHubApiCommitAuthor {
  name: string
  email: string
  date: string
}

interface GitHubApiCommitResponse {
  sha: string
  commit: {
    message: string
    author: GitHubApiCommitAuthor
    committer: GitHubApiCommitAuthor
  }
  html_url: string
  author?: { login?: string; avatar_url?: string } | null
  parents?: Array<{ sha: string }>
}

interface GitHubApiFileEntry {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
  previous_filename?: string
}

interface GitHubApiCompareResponse {
  status: string
  ahead_by: number
  behind_by: number
  total_commits: number
  commits: GitHubApiCommitResponse[]
  files?: GitHubApiFileEntry[]
}

interface GitHubApiCommitDetailResponse extends GitHubApiCommitResponse {
  stats?: { additions: number; deletions: number; total: number }
  files?: GitHubApiFileEntry[]
}

interface GitHubApiRateLimitResponse {
  rate?: { limit: number; remaining: number; reset: number }
  resources?: { core?: { limit: number; remaining: number; reset: number } }
}

// --- Normalizer functions ---

function normalizeRepo(data: GitHubApiRepoResponse): GitHubRepo {
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description,
    defaultBranch: data.default_branch,
    stars: data.stargazers_count,
    forks: data.forks_count,
    language: data.language,
    topics: data.topics || [],
    isPrivate: data.private,
    url: data.html_url,
    size: data.size,
    openIssuesCount: data.open_issues_count ?? 0,
    pushedAt: data.pushed_at ?? '',
    license: data.license?.spdx_id ?? null,
  }
}

function normalizeTags(data: GitHubApiTagResponse[]): GitHubTag[] {
  return data.map((tag) => ({
    name: tag.name,
    commitSha: tag.commit.sha,
    commitUrl: tag.commit.url,
    tarballUrl: tag.tarball_url ?? '',
    zipballUrl: tag.zipball_url ?? '',
  }))
}

function normalizeBranches(data: GitHubApiBranchResponse[]): GitHubBranch[] {
  return data.map((branch) => ({
    name: branch.name,
    commitSha: branch.commit.sha,
    isProtected: branch.protected ?? false,
  }))
}

function normalizeCommits(data: GitHubApiCommitResponse[]): GitHubCommit[] {
  return data.map((item) => {
    const commit = item.commit
    const commitAuthor = commit.author
    const commitCommitter = commit.committer
    const author = item.author
    return {
      sha: item.sha,
      message: commit.message,
      authorName: commitAuthor.name,
      authorEmail: commitAuthor.email,
      authorDate: commitAuthor.date,
      committerName: commitCommitter.name,
      committerDate: commitCommitter.date,
      url: item.html_url,
      authorLogin: author?.login ?? null,
      authorAvatarUrl: author?.avatar_url ?? null,
      parents: (item.parents ?? []).map((p) => ({ sha: p.sha })),
    }
  })
}

function normalizeCompare(data: GitHubApiCompareResponse): GitHubComparison {
  return {
    status: data.status,
    aheadBy: data.ahead_by,
    behindBy: data.behind_by,
    totalCommits: data.total_commits,
    commits: normalizeCommits(data.commits),
    files: (data.files ?? []).map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    })),
  }
}

function normalizeCommitDetail(data: GitHubApiCommitDetailResponse): CommitDetail {
  const commit = data.commit
  const commitAuthor = commit.author
  const commitCommitter = commit.committer
  const author = data.author
  const stats = data.stats ?? { additions: 0, deletions: 0, total: 0 }
  return {
    sha: data.sha,
    message: commit.message,
    authorName: commitAuthor.name,
    authorEmail: commitAuthor.email,
    authorDate: commitAuthor.date,
    committerName: commitCommitter.name,
    committerDate: commitCommitter.date,
    url: data.html_url,
    authorLogin: author?.login ?? null,
    authorAvatarUrl: author?.avatar_url ?? null,
    parents: (data.parents ?? []).map((p) => ({ sha: p.sha })),
    stats: {
      additions: stats.additions,
      deletions: stats.deletions,
      total: stats.total,
    },
    files: (data.files ?? []).map((file): CommitFile => ({
      filename: file.filename,
      status: file.status as CommitFile['status'],
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
      previousFilename: file.previous_filename,
    })),
  }
}

function normalizeRateLimit(data: GitHubApiRateLimitResponse): { limit: number; remaining: number; reset: number; authenticated: boolean } {
  const core = data.rate ?? data.resources?.core
  return {
    limit: core?.limit ?? 0,
    remaining: core?.remaining ?? 0,
    reset: core?.reset ?? 0,
    authenticated: true,
  }
}

/** Apply the appropriate normalization for a given endpoint. */
function normalizeDirectResponse<T>(data: unknown, endpoint: ProxyEndpoint): T {
  switch (endpoint) {
    case 'repo':        return normalizeRepo(data as GitHubApiRepoResponse) as T
    case 'tree':        return data as T
    case 'tags':        return normalizeTags(data as GitHubApiTagResponse[]) as T
    case 'branches':    return normalizeBranches(data as GitHubApiBranchResponse[]) as T
    case 'commits':     return normalizeCommits(data as GitHubApiCommitResponse[]) as T
    case 'compare':     return normalizeCompare(data as GitHubApiCompareResponse) as T
    case 'commit':      return normalizeCommitDetail(data as GitHubApiCommitDetailResponse) as T
    case 'rate-limit':  return normalizeRateLimit(data as GitHubApiRateLimitResponse) as T
    default:            return data as T
  }
}

// ---------------------------------------------------------------------------
// Blame GraphQL query — duplicated from lib/github/fetcher.ts for client-side use
// ---------------------------------------------------------------------------

const BLAME_QUERY = `
query BlameData($owner: String!, $name: String!, $expression: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      ... on Blob {
        byteSize
        isTruncated
        blame(startingLine: 1) {
          ranges {
            startingLine
            endingLine
            age
            commit {
              oid
              abbreviatedOid
              message
              messageHeadline
              committedDate
              url
              author {
                name
                email
                date
                user {
                  login
                  avatarUrl
                }
              }
            }
          }
        }
      }
    }
  }
}
`

interface BlameGraphQLResponse {
  data: {
    repository: {
      object: {
        byteSize: number
        isTruncated: boolean
        blame: {
          ranges: BlameData['ranges']
        }
      } | null
    }
  }
  errors?: Array<{ message: string }>
}

// ---------------------------------------------------------------------------
// Core fetch — proxy or direct depending on PAT availability
// ---------------------------------------------------------------------------

/**
 * Client-side fetcher that calls proxy API routes or GitHub API directly.
 * When a PAT is available, bypasses the proxy to reduce latency.
 * When no PAT is set, falls back to the proxy routes (used by OAuth users).
 */
async function proxyFetch<T>(url: string, timeoutMs?: number): Promise<T> {
  if (!url.startsWith('/') || url.startsWith('//')) {
    throw new Error('proxyFetch only accepts relative URLs')
  }

  // Direct mode: PAT is available — call GitHub API directly
  // Skip direct mode for file fetches: raw.githubusercontent.com rejects
  // browser preflight requests triggered by the Authorization header (CORS).
  const pat = getGitHubPAT()
  if (pat) {
    const mapping = mapProxyUrlToGitHubApi(url)
    if (mapping && mapping.endpoint !== 'file') {
      const raw = await directFetch(mapping.url, pat, timeoutMs)
      return normalizeDirectResponse<T>(raw, mapping.endpoint)
    }
  }

  // Proxy mode: no PAT or unrecognized path — use proxy routes
  const fetchOptions: RequestInit = { headers: buildProxyHeaders() }
  if (timeoutMs) {
    fetchOptions.signal = AbortSignal.timeout(timeoutMs)
  }
  const response = await fetch(url, fetchOptions)

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
  timeoutMs?: number,
): Promise<T> {
  // 1. Fresh cache hit — return immediately
  const fresh = getCached<T>(cacheKey)
  if (fresh !== null) return fresh

  // 2. Stale hit — return stale data, revalidate in background
  const stale = getStale<T>(cacheKey)
  if (stale !== null && stale.isStale) {
    // Fire-and-forget background revalidation
    proxyFetch<T>(url, timeoutMs)
      .then((data) => setCache(cacheKey, data, ttl))
      .catch((err) => {
        console.warn('[cachedProxyFetch] Background revalidation failed:', cacheKey, err)
      })
    return stale.data
  }

  // 3. Cache miss — fetch, cache, return
  const data = await proxyFetch<T>(url, timeoutMs)
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
  options?: { timeoutMs?: number },
): Promise<string> {
  const key = `file:${owner}/${name}:${branch}:${path}`
  const url = `/api/github/file?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`

  // File content returns { content: string } — unwrap after caching the raw response
  const data = await cachedProxyFetch<{ content: string }>(key, url, CACHE_TTL_FILE, options?.timeoutMs ?? 15_000)
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

/**
 * Fetch repository language breakdown through the proxy.
 * Returns an object mapping language names to byte counts.
 */
export async function fetchLanguagesViaProxy(
  owner: string,
  name: string,
): Promise<Record<string, number>> {
  const key = `languages:${owner}/${name}`
  const url = `/api/github/languages?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`
  return cachedProxyFetch<Record<string, number>>(key, url, CACHE_TTL_LANGUAGES)
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
  const key = `tags:${owner}/${name}:${perPage ?? 30}`
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
  const key = `branches:${owner}/${name}:${perPage ?? 30}`
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
 * Fetch both tags and branches in a single request through the combined refs proxy.
 */
export async function fetchRefsViaProxy(
  owner: string,
  name: string,
  perPage?: number,
): Promise<{ tags: GitHubTag[]; branches: GitHubBranch[] }> {
  const key = `refs:${owner}/${name}:${perPage ?? 30}`
  const params = new URLSearchParams({ owner, name })
  if (perPage !== undefined) params.set('per_page', String(perPage))
  const url = `/api/github/refs?${params.toString()}`
  return cachedProxyFetch<{ tags: GitHubTag[]; branches: GitHubBranch[] }>(key, url, CACHE_TTL_TAGS)
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

/** Internal helper: fetch blame data via proxy or direct GraphQL. */
async function fetchBlameFromApi(
  owner: string,
  name: string,
  ref: string,
  path: string,
): Promise<BlameData> {
  // Direct mode: PAT available — call GitHub GraphQL API directly
  const pat = getGitHubPAT()
  if (pat) {
    const expression = `${ref}:${path}`
    const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: BLAME_QUERY,
        variables: { owner, name, expression },
      }),
    })

    if (response.status === 401) {
      throw new Error('Authentication required to fetch blame data')
    }
    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.statusText}`)
    }

    const body = (await response.json()) as BlameGraphQLResponse
    if (body.errors && body.errors.length > 0) {
      throw new Error(body.errors[0].message)
    }

    if (!body.data?.repository) {
      throw new Error('Repository not found or inaccessible')
    }
    const blob = body.data.repository.object
    if (!blob) {
      throw new Error(`File not found: ${path}`)
    }

    return {
      ranges: blob.blame.ranges,
      isTruncated: blob.isTruncated,
      byteSize: blob.byteSize,
    }
  }

  // Proxy mode: no PAT — POST to proxy route
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
// Pull requests — proxy fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch pull requests list through the proxy.
 */
export async function fetchPullsViaProxy(
  owner: string,
  name: string,
  opts?: { state?: string; perPage?: number; page?: number; sort?: string; direction?: string },
): Promise<PRMetadata[]> {
  const params = new URLSearchParams()
  params.set('owner', owner)
  params.set('name', name)
  if (opts?.state) params.set('state', opts.state)
  if (opts?.perPage !== undefined) params.set('per_page', String(opts.perPage))
  if (opts?.page !== undefined) params.set('page', String(opts.page))
  if (opts?.sort) params.set('sort', opts.sort)
  if (opts?.direction) params.set('direction', opts.direction)

  const key = `pulls:${owner}/${name}:${params.toString()}`
  const url = `/api/github/pulls?${params.toString()}`
  return cachedProxyFetch<PRMetadata[]>(key, url, CACHE_TTL_PULLS)
}

/**
 * Fetch a single pull request through the proxy.
 */
export async function fetchPullRequestViaProxy(
  owner: string,
  name: string,
  number: number,
): Promise<PRMetadata> {
  const key = `pr:${owner}/${name}:${number}`
  const url = `/api/github/pulls/${number}?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`
  return cachedProxyFetch<PRMetadata>(key, url, CACHE_TTL_PULLS)
}

/**
 * Fetch pull request files through the proxy.
 */
export async function fetchPullRequestFilesViaProxy(
  owner: string,
  name: string,
  number: number,
  opts?: { perPage?: number; page?: number },
): Promise<PRFile[]> {
  const params = new URLSearchParams()
  params.set('owner', owner)
  params.set('name', name)
  if (opts?.perPage !== undefined) params.set('per_page', String(opts.perPage))
  if (opts?.page !== undefined) params.set('page', String(opts.page))

  const key = `pr-files:${owner}/${name}:${number}:${params.toString()}`
  const url = `/api/github/pulls/${number}/files?${params.toString()}`
  return cachedProxyFetch<PRFile[]>(key, url, CACHE_TTL_PULLS)
}

/**
 * Fetch pull request review comments through the proxy.
 */
export async function fetchPullRequestCommentsViaProxy(
  owner: string,
  name: string,
  number: number,
  opts?: { perPage?: number; page?: number },
): Promise<PRComment[]> {
  const params = new URLSearchParams()
  params.set('owner', owner)
  params.set('name', name)
  if (opts?.perPage !== undefined) params.set('per_page', String(opts.perPage))
  if (opts?.page !== undefined) params.set('page', String(opts.page))

  const key = `pr-comments:${owner}/${name}:${number}:${params.toString()}`
  const url = `/api/github/pulls/${number}/comments?${params.toString()}`
  return cachedProxyFetch<PRComment[]>(key, url, CACHE_TTL_PULLS)
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
  invalidatePattern(`pulls:${owner}/${repo}`)
  invalidatePattern(`pr:${owner}/${repo}`)
  invalidatePattern(`pr-files:${owner}/${repo}`)
  invalidatePattern(`pr-comments:${owner}/${repo}`)
}

// Exposed for unit tests only — not part of the public API.
export const _testInternals = { proxyFetch } as const
