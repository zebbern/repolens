/**
 * Mode-parity contract for GitHub access.
 *
 * Every endpoint that PAT direct mode sends straight from the browser to
 * GitHub runs twice against one fake GitHub: once through the real
 * `/api/github/*` route handlers (proxy mode, as a signed-in OAuth user) and
 * once direct with a PAT. Success payloads must be identical in both modes.
 *
 * Today's differences are listed in KNOWN_DIVERGENCES with each mode's
 * outcome. A difference that is not listed fails the suite, and so does a
 * listed one that changes or disappears: fixing a divergence means deleting
 * its row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/token', () => ({
  // Proxy mode runs as an OAuth user so both modes reach GitHub authenticated.
  getAccessToken: () => Promise.resolve('gho_oauth'),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: () => null,
  refundRateLimit: () => {},
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  clearGitHubCache,
  fetchBlameViaProxy,
  fetchBranchesViaProxy,
  fetchCommitDetailViaProxy,
  fetchCommitsViaProxy,
  fetchCompareViaProxy,
  fetchFileCommitsViaProxy,
  fetchRepoViaProxy,
  fetchTagsViaProxy,
  fetchTreeViaProxy,
  setGitHubPAT,
} from '../client'
import { isGitHubError, type GitHubErrorKind } from '../errors'
import { GET as repoRoute } from '@/app/api/github/repo/route'
import { GET as treeRoute } from '@/app/api/github/tree/route'
import { GET as tagsRoute } from '@/app/api/github/tags/route'
import { GET as branchesRoute } from '@/app/api/github/branches/route'
import { GET as commitsRoute } from '@/app/api/github/commits/route'
import { GET as compareRoute } from '@/app/api/github/compare/route'
import { GET as commitRoute } from '@/app/api/github/commit/[sha]/route'
import { POST as blameRoute } from '@/app/api/github/blame/route'

const PAT = 'ghp_direct'
const OAUTH_TOKEN = 'gho_oauth'
const API = 'https://api.github.com'
const REPO_PATH = '/repos/X/Y'
/** Where GitHub moved the repository in the redirect scenario. */
const RENAMED_REPO_PATH = '/repositories/42'

// ---------------------------------------------------------------------------
// Upstream scenarios: how the fake GitHub answers every request
// ---------------------------------------------------------------------------

const SCENARIOS = [
  'ok',
  '404',
  '401',
  '403-rate',
  '403-forbidden',
  '422',
  '429',
  '5xx',
  'redirect',
] as const
type Scenario = typeof SCENARIOS[number]
type FailureScenario = Exclude<Scenario, 'ok' | 'redirect'>

const SAML_MESSAGE = 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.'
const SECONDARY_LIMIT_MESSAGE = 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.'

let scenario: Scenario = 'ok'
const graphqlQueries: string[] = []

function json(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

/** GitHub's REST answer for each failure scenario. */
function restFailure(failure: FailureScenario): Response {
  switch (failure) {
    case '404': return json({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' })
    case '401': return json({ message: 'Bad credentials' }, { status: 401, statusText: 'Unauthorized' })
    case '403-rate': return json(
      { message: 'API rate limit exceeded for user ID 1.' },
      { status: 403, statusText: 'Forbidden', headers: { 'X-RateLimit-Remaining': '0' } },
    )
    case '403-forbidden': return json({ message: SAML_MESSAGE }, { status: 403, statusText: 'Forbidden' })
    case '422': return json({ message: 'Validation Failed' }, { status: 422, statusText: 'Unprocessable Entity' })
    case '429': return json(
      { message: SECONDARY_LIMIT_MESSAGE },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '60' } },
    )
    case '5xx': return json({ message: 'Server Error' }, { status: 502, statusText: 'Bad Gateway' })
  }
}

/**
 * GitHub's GraphQL answer for each failure scenario. A missing repository and
 * the primary rate limit arrive as HTTP 200 with typed errors; the rest use
 * the HTTP status.
 */
function graphqlFailure(failure: FailureScenario): Response {
  if (failure === '404') {
    return json({
      data: { repository: null },
      errors: [{ type: 'NOT_FOUND', path: ['repository'], message: "Could not resolve to a Repository with the name 'X/Y'." }],
    })
  }
  if (failure === '403-rate') {
    return json({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for user ID 1.' }] })
  }
  return restFailure(failure)
}

// ---------------------------------------------------------------------------
// Success fixtures (raw GitHub shapes, including optional fields left out)
// ---------------------------------------------------------------------------

const RAW_REPO = {
  owner: { login: 'X' },
  name: 'Y',
  full_name: 'X/Y',
  description: null,
  default_branch: 'main',
  stargazers_count: 7,
  forks_count: 2,
  language: 'TypeScript',
  topics: ['parity'],
  private: true,
  html_url: 'https://github.com/X/Y',
  size: 128,
  open_issues_count: 3,
  pushed_at: '2026-10-01T00:00:00Z',
  license: null,
  fork: true,
  parent: { full_name: 'upstream/Y' },
}

function blob(path: string, size = 10) {
  return { path, mode: '100644', type: 'blob', sha: `b-${path}`, size, url: `${API}${REPO_PATH}/git/blobs/b-${path}` }
}

function treeEntry(path: string, sha: string) {
  return { path, mode: '040000', type: 'tree', sha, url: `${API}${REPO_PATH}/git/trees/${sha}` }
}

/** Trees by `${sha}:${recursive}`; `big` is truncated and needs a subtree walk. */
const RAW_TREES: Record<string, unknown> = {
  'HEAD:true': { sha: 'root-sha', tree: [blob('README.md'), treeEntry('src', 't-src'), blob('src/a.ts', 42)], truncated: false },
  'big:true': { sha: 'big-sha', tree: [blob('README.md')], truncated: true },
  'big-sha:false': { sha: 'big-sha', tree: [blob('README.md'), treeEntry('lib', 't-lib')], truncated: false },
  't-lib:true': { sha: 't-lib', tree: [blob('b.ts', 5)], truncated: false },
}

const RAW_TAGS = [
  {
    name: 'v1',
    commit: { sha: 'sha-v1', url: `${API}${REPO_PATH}/commits/sha-v1` },
    tarball_url: `${API}${REPO_PATH}/tarball/v1`,
    zipball_url: `${API}${REPO_PATH}/zipball/v1`,
  },
  { name: 'v0', commit: { sha: 'sha-v0', url: `${API}${REPO_PATH}/commits/sha-v0` } },
]

const RAW_BRANCHES = [
  { name: 'main', commit: { sha: 'sha-main' }, protected: true },
  { name: 'dev', commit: { sha: 'sha-dev' } },
]

function rawCommit(sha: string, message: string) {
  return {
    sha,
    commit: {
      message,
      author: { name: 'Alice', email: 'alice@example.com', date: '2026-09-01T00:00:00Z' },
      committer: { name: 'Bob', email: 'bob@example.com', date: '2026-09-02T00:00:00Z' },
    },
    html_url: `https://github.com/X/Y/commit/${sha}`,
    author: { login: 'alice', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
    parents: [{ sha: `${sha}-parent` }],
  }
}

/**
 * The commit list echoes its effective query (GitHub defaults applied), so a
 * filter or paging parameter that only one mode sends shows up as a divergence.
 */
function rawCommitList(params: URLSearchParams) {
  const query = ['sha', 'path', 'since', 'until']
    .map(key => `${key}=${params.get(key) ?? ''}`)
    .concat(`page=${params.get('page') ?? '1'}`, `per_page=${params.get('per_page') ?? '30'}`)
    .join(' ')
  // The root commit has no linked GitHub user and no `parents` field.
  const root = rawCommit('c0', 'root commit')
  return [
    rawCommit('c1', `history for ${query}`),
    { sha: root.sha, commit: root.commit, html_url: root.html_url, author: null },
  ]
}

const RAW_COMPARE = {
  status: 'ahead',
  ahead_by: 1,
  behind_by: 0,
  total_commits: 1,
  commits: [rawCommit('c1', 'feat: compare')],
  files: [
    { filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, changes: 3, patch: '@@ -1 +1,2 @@' },
    { filename: 'logo.png', status: 'added', additions: 0, deletions: 0, changes: 0 },
  ],
}

const RAW_COMMIT_DETAIL = {
  ...rawCommit('abc1234', 'fix: detail'),
  stats: { additions: 2, deletions: 1, total: 3 },
  files: [{
    filename: 'src/b.ts', status: 'renamed', additions: 2, deletions: 1, changes: 3,
    patch: '@@ -1 +1,2 @@', previous_filename: 'src/a.ts',
  }],
}

/** A commit GitHub returned without `stats`. */
const RAW_COMMIT_DETAIL_WITHOUT_STATS = { ...rawCommit('feedface', 'chore: no stats'), files: [] }

const RAW_BLAME = {
  byteSize: 42,
  isTruncated: false,
  blame: {
    ranges: [{
      startingLine: 1,
      endingLine: 2,
      age: 3,
      commit: {
        oid: 'c1', abbreviatedOid: 'c1', message: 'feat: a', messageHeadline: 'feat: a',
        committedDate: '2026-09-02T00:00:00Z', url: 'https://github.com/X/Y/commit/c1',
        author: { name: 'Alice', email: 'alice@example.com', date: '2026-09-01T00:00:00Z', user: { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' } },
      },
    }],
  },
}

// ---------------------------------------------------------------------------
// Fake GitHub
// ---------------------------------------------------------------------------

function restSuccess(url: URL): Response {
  const path = url.pathname.startsWith(RENAMED_REPO_PATH)
    ? REPO_PATH + url.pathname.slice(RENAMED_REPO_PATH.length)
    : url.pathname
  const notFound = () => restFailure('404')
  if (!path.startsWith(REPO_PATH)) return notFound()
  const rest = path.slice(REPO_PATH.length)

  if (rest === '') return json(RAW_REPO)
  if (rest === '/tags') return json(RAW_TAGS)
  if (rest === '/branches') return json(RAW_BRANCHES)
  if (rest === '/commits') return json(rawCommitList(url.searchParams))
  if (rest === '/compare/v0...v1') return json(RAW_COMPARE)
  if (rest === '/commits/abc1234') return json(RAW_COMMIT_DETAIL)
  if (rest === '/commits/feedface') return json(RAW_COMMIT_DETAIL_WITHOUT_STATS)
  const treeMatch = rest.match(/^\/git\/trees\/([^/]+)$/)
  if (treeMatch) {
    const tree = RAW_TREES[`${decodeURIComponent(treeMatch[1])}:${url.searchParams.get('recursive') === '1'}`]
    return tree ? json(tree) : notFound()
  }
  return notFound()
}

function graphqlSuccess(body: { query: string; variables: { owner: string; name: string; expression: string } }): Response {
  const { owner, name, expression } = body.variables
  if (owner !== 'X' || name !== 'Y') return graphqlFailure('404')
  if (expression === 'main:null-repo.ts') return json({ data: { repository: null } })
  if (expression !== 'main:src/a.ts') return json({ data: { repository: { object: null } } })
  return json({ data: { repository: { object: RAW_BLAME } } })
}

function respond(url: URL, init: RequestInit): Response {
  const isGraphQL = url.pathname === '/graphql'
  if (scenario === 'redirect' && !isGraphQL && url.pathname.startsWith(REPO_PATH)) {
    // GitHub answers requests for a renamed or transferred repository with 301.
    const location = `${API}${RENAMED_REPO_PATH}${url.pathname.slice(REPO_PATH.length)}${url.search}`
    return new Response(null, { status: 301, statusText: 'Moved Permanently', headers: { Location: location } })
  }
  if (scenario !== 'ok' && scenario !== 'redirect') {
    return isGraphQL ? graphqlFailure(scenario) : restFailure(scenario)
  }

  // The fixture repository is private: GitHub hides it from anonymous requests.
  const auth = new Headers(init.headers).get('Authorization')
  if (auth !== `Bearer ${PAT}` && auth !== `Bearer ${OAUTH_TOKEN}`) {
    return isGraphQL ? restFailure('401') : restFailure('404')
  }
  if (isGraphQL) {
    const body = JSON.parse(String(init.body)) as Parameters<typeof graphqlSuccess>[0]
    graphqlQueries.push(body.query)
    return graphqlSuccess(body)
  }
  return restSuccess(url)
}

/**
 * Serve a GitHub URL, applying fetch's redirect mode the way a browser does:
 * 'error' rejects with a network error; 'follow' (the default) re-requests the
 * Location, drops Authorization when the redirect crosses origins, turns a
 * 301/302 POST (and any 303) into a bodiless GET, and returns the final
 * response with `redirected` and `url` set.
 */
function fakeGitHub(input: string, init: RequestInit): Response {
  let url = new URL(input)
  let request: RequestInit = { ...init, headers: new Headers(init.headers) }
  for (let hops = 0; hops < 5; hops++) {
    const response = respond(url, request)
    if (response.status < 300 || response.status >= 400) {
      Object.defineProperty(response, 'url', { value: url.href })
      Object.defineProperty(response, 'redirected', { value: hops > 0 })
      return response
    }
    if (init.redirect === 'error') throw new TypeError('Failed to fetch')
    if (init.redirect === 'manual') throw new Error('The fake GitHub does not model redirect: manual')
    const next = new URL(response.headers.get('Location') ?? '', url)
    const headers = new Headers(request.headers)
    if (next.origin !== url.origin) headers.delete('Authorization')
    const method = (request.method ?? 'GET').toUpperCase()
    const toGet = response.status === 303
      ? method !== 'GET' && method !== 'HEAD'
      : (response.status === 301 || response.status === 302) && method === 'POST'
    request = toGet ? { ...request, method: 'GET', body: undefined, headers } : { ...request, headers }
    url = next
  }
  throw new TypeError('Too many redirects')
}

/** Serve proxy routes with the real handlers and GitHub URLs with the fake. */
async function serve(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const raw = String(input)
  if (!raw.startsWith('/api/github/')) return fakeGitHub(raw, init)

  const request = new NextRequest(`http://localhost${raw}`, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  })
  const { pathname } = request.nextUrl
  if (pathname === '/api/github/repo') return repoRoute(request)
  if (pathname === '/api/github/tree') return treeRoute(request)
  if (pathname === '/api/github/tags') return tagsRoute(request)
  if (pathname === '/api/github/branches') return branchesRoute(request)
  if (pathname === '/api/github/commits') return commitsRoute(request)
  if (pathname === '/api/github/compare') return compareRoute(request)
  if (pathname === '/api/github/blame') return blameRoute(request)
  const commitMatch = pathname.match(/^\/api\/github\/commit\/([^/]+)$/)
  if (commitMatch) {
    return commitRoute(request, { params: Promise.resolve({ sha: decodeURIComponent(commitMatch[1]) }) })
  }
  throw new Error(`No route handler for ${pathname}`)
}

// ---------------------------------------------------------------------------
// Running one call in one mode
// ---------------------------------------------------------------------------

type Mode = 'proxy' | 'direct'
/** A failure is compared by message and GitHubError kind (undefined for other errors). */
type Outcome = { ok: true; value: unknown } | { ok: false; error: string; kind?: GitHubErrorKind }
type Call = () => Promise<unknown>

async function run(mode: Mode, upstream: Scenario, call: Call): Promise<Outcome> {
  scenario = upstream
  setGitHubPAT(mode === 'direct' ? PAT : null)
  clearGitHubCache()
  const firstCall = mockFetch.mock.calls.length

  let outcome: Outcome
  try {
    outcome = { ok: true, value: await call() }
  } catch (error) {
    outcome = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      kind: isGitHubError(error) ? error.kind : undefined,
    }
  }

  // Each mode must really use its own transport.
  const usedProxy = mockFetch.mock.calls
    .slice(firstCall)
    .some(([input]) => String(input).startsWith('/api/github/'))
  expect(usedProxy, `${mode} mode transport`).toBe(mode === 'proxy')
  return outcome
}

/** Every endpoint PAT direct mode serves without the proxy. */
const ENDPOINTS = {
  repo: () => fetchRepoViaProxy('X', 'Y'),
  tree: () => fetchTreeViaProxy('X', 'Y', 'HEAD'),
  tags: () => fetchTagsViaProxy('X', 'Y'),
  branches: () => fetchBranchesViaProxy('X', 'Y'),
  commits: () => fetchCommitsViaProxy('X', 'Y', { sha: 'main', since: '2026-01-01T00:00:00Z', page: 2 }),
  'file commits': () => fetchFileCommitsViaProxy('X', 'Y', 'src/a.ts'),
  compare: () => fetchCompareViaProxy('X', 'Y', 'v0', 'v1'),
  'commit detail': () => fetchCommitDetailViaProxy('X', 'Y', 'abc1234'),
  blame: () => fetchBlameViaProxy('X', 'Y', 'main', 'src/a.ts'),
} satisfies Record<string, Call>

/** `ok`-scenario fixture variants that exercise optional or unusual GitHub data. */
const SUCCESS_VARIANTS = {
  'tree (truncated root, subtree walk)': () => fetchTreeViaProxy('X', 'Y', 'big'),
  'commit detail (no stats)': () => fetchCommitDetailViaProxy('X', 'Y', 'feedface'),
  'blame (null repository)': () => fetchBlameViaProxy('X', 'Y', 'main', 'null-repo.ts'),
} satisfies Record<string, Call>

/** Variants whose GitHub data both modes must report as the same failure. */
const FAILING_VARIANTS = new Set(['blame (null repository) / ok'])

interface Cell {
  key: string
  scenario: Scenario
  call: Call
}

const CELLS: Cell[] = [
  ...Object.entries(ENDPOINTS).flatMap(([endpoint, call]) =>
    SCENARIOS.map((upstream): Cell => ({ key: `${endpoint} / ${upstream}`, scenario: upstream, call })),
  ),
  ...Object.entries(SUCCESS_VARIANTS).map(([variant, call]): Cell => ({ key: `${variant} / ok`, scenario: 'ok', call })),
]

// ---------------------------------------------------------------------------
// Known divergences (today's behaviour, recorded per mode)
// ---------------------------------------------------------------------------

/** `'success'` means the mode's own outcome for the same call in the `ok` scenario. */
type Expected = Outcome | 'success'

interface Divergence {
  proxy: Expected
  direct: Expected
}

function failed(error: string, kind?: GitHubErrorKind): Outcome {
  return { ok: false, error, kind }
}

function succeeded(partial: Record<string, unknown>): Outcome {
  return { ok: true, value: expect.objectContaining(partial) }
}

const KNOWN_DIVERGENCES: Record<string, Divergence> = {
  // Unusual success data: the server fetcher throws a TypeError (reported as
  // a generic 500) where direct mode defaults the missing stats to zeros.
  'commit detail (no stats) / ok': {
    proxy: failed('Failed to fetch commit detail', 'upstream'),
    direct: succeeded({ sha: 'feedface', stats: { additions: 0, deletions: 0, total: 0 } }),
  },
}

async function resolveExpected(expected: Expected, mode: Mode, call: Call): Promise<Outcome> {
  return expected === 'success' ? run(mode, 'ok', call) : expected
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(serve)
  graphqlQueries.length = 0
  scenario = 'ok'
  setGitHubPAT(null)
  clearGitHubCache()
  // Routes log upstream failures; the outcomes are asserted instead.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('GitHub access parity: proxy mode vs PAT direct mode', () => {
  it.each(CELLS)('$key', async ({ key, scenario: upstream, call }) => {
    const proxy = await run('proxy', upstream, call)
    const direct = await run('direct', upstream, call)
    const known = KNOWN_DIVERGENCES[key]

    if (!known) {
      if (upstream === 'ok') expect(proxy.ok, `${key}: fixture must succeed`).toBe(!FAILING_VARIANTS.has(key))
      // A renamed or transferred repository loads as if it had not moved.
      if (upstream === 'redirect') expect(proxy, `${key}: redirect must be followed`).toEqual(await run('proxy', 'ok', call))
      expect(direct, `${key}: new divergence; fix it or list it in KNOWN_DIVERGENCES`).toEqual(proxy)
      return
    }

    expect(proxy, `${key}: proxy outcome changed; update its KNOWN_DIVERGENCES row`)
      .toEqual(await resolveExpected(known.proxy, 'proxy', call))
    expect(direct, `${key}: direct outcome changed; update its KNOWN_DIVERGENCES row`)
      .toEqual(await resolveExpected(known.direct, 'direct', call))
    expect(direct, `${key}: no longer diverges; delete its KNOWN_DIVERGENCES row`).not.toEqual(proxy)
  })

  it('lists only divergences for cells the suite runs', () => {
    const keys = new Set(CELLS.map(cell => cell.key))
    expect(Object.keys(KNOWN_DIVERGENCES).filter(key => !keys.has(key))).toEqual([])
  })

  it('reports each upstream failure as the decided GitHubError kind', async () => {
    const failures = ['404', '401', '403-rate', '403-forbidden', '422', '429', '5xx'] as const
    const kinds: Record<string, unknown> = {}
    for (const upstream of failures) {
      for (const [endpoint, call] of [['repo', ENDPOINTS.repo], ['blame', ENDPOINTS.blame]] as const) {
        const outcome = await run('direct', upstream, call)
        kinds[`${endpoint} / ${upstream}`] = outcome.ok ? 'success' : outcome.kind
      }
    }

    // Parity makes proxy mode report the same kinds.
    expect(kinds).toEqual(Object.fromEntries(['repo', 'blame'].flatMap(endpoint => [
      [`${endpoint} / 404`, 'not_found'],
      [`${endpoint} / 401`, 'unauthorized'],
      [`${endpoint} / 403-rate`, 'rate_limited'],
      [`${endpoint} / 403-forbidden`, 'forbidden'],
      [`${endpoint} / 422`, 'invalid'],
      [`${endpoint} / 429`, 'rate_limited'],
      [`${endpoint} / 5xx`, 'upstream'],
    ])))
  })

  it('sends the same blame GraphQL query in both modes', async () => {
    await run('proxy', 'ok', ENDPOINTS.blame)
    await run('direct', 'ok', ENDPOINTS.blame)

    expect(graphqlQueries).toHaveLength(2)
    expect(graphqlQueries[1]).toBe(graphqlQueries[0])
  })
})
