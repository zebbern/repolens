/**
 * Error contract of the GitHub proxy routes.
 *
 * Every route that reaches GitHub through lib/github/fetcher.ts runs against a
 * fake GitHub for each upstream failure, with the real fetcher and the real
 * route handler. The table records what the client receives: HTTP status,
 * error code and message (tree failures arrive as a 200 partial tree, so the
 * message is the root failure detail).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: () => Promise.resolve('gho_oauth'),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: () => null,
  refundRateLimit: () => {},
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { GET as repoRoute } from '../repo/route'
import { GET as treeRoute } from '../tree/route'
import { GET as fileRoute } from '../file/route'
import { GET as tagsRoute } from '../tags/route'
import { GET as branchesRoute } from '../branches/route'
import { GET as commitsRoute } from '../commits/route'
import { GET as compareRoute } from '../compare/route'
import { GET as commitRoute } from '../commit/[sha]/route'
import { GET as pullsRoute } from '../pulls/route'
import { GET as pullRoute } from '../pulls/[number]/route'
import { GET as pullFilesRoute } from '../pulls/[number]/files/route'
import { POST as blameRoute } from '../blame/route'

// ---------------------------------------------------------------------------
// Upstream failures
// ---------------------------------------------------------------------------

const FAILURES = [
  '404',
  '401',
  '403-rate',
  '403-forbidden',
  '422',
  '429',
  '502',
  'timeout',
  'network',
  'abort',
] as const
type Failure = typeof FAILURES[number]

/** Upstream text that must never reach the client. */
const UPSTREAM_SECRET = 'upstream-detail-7f3a'

function json(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...init.headers },
  })
}

function restFailure(failure: Failure): Response {
  switch (failure) {
    case '404': return json({ message: `Not Found ${UPSTREAM_SECRET}` }, { status: 404, statusText: 'Not Found' })
    case '401': return json({ message: `Bad credentials ${UPSTREAM_SECRET}` }, { status: 401, statusText: 'Unauthorized' })
    case '403-rate': return json(
      { message: `API rate limit exceeded for user ID 1. ${UPSTREAM_SECRET}` },
      { status: 403, statusText: 'Forbidden', headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '4102444800' } },
    )
    case '403-forbidden': return json(
      { message: `Resource protected by organization SAML enforcement. ${UPSTREAM_SECRET}` },
      { status: 403, statusText: 'Forbidden' },
    )
    case '422': return json({ message: `Validation Failed ${UPSTREAM_SECRET}` }, { status: 422, statusText: 'Unprocessable Entity' })
    case '429': return json(
      { message: `You have exceeded a secondary rate limit. ${UPSTREAM_SECRET}` },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '60' } },
    )
    default: return json({ message: `Server Error ${UPSTREAM_SECRET}` }, { status: 502, statusText: 'Bad Gateway' })
  }
}

/** GitHub GraphQL reports a missing repository and the primary rate limit as HTTP 200. */
function graphqlFailure(failure: Failure): Response {
  if (failure === '404') {
    return json({
      data: { repository: null },
      errors: [{ type: 'NOT_FOUND', path: ['repository'], message: `Could not resolve to a Repository ${UPSTREAM_SECRET}` }],
    })
  }
  if (failure === '403-rate') {
    return json({ data: null, errors: [{ type: 'RATE_LIMITED', message: `API rate limit exceeded ${UPSTREAM_SECRET}` }] })
  }
  return restFailure(failure)
}

let failure: Failure = '404'

function fakeGitHub(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (failure === 'timeout') {
    // fetchGitHub aborts its request with a TimeoutError when its deadline passes.
    return Promise.reject(new DOMException(`GitHub request timed out ${UPSTREAM_SECRET}`, 'TimeoutError'))
  }
  if (failure === 'network') return Promise.reject(new TypeError(`fetch failed ${UPSTREAM_SECRET}`))
  if (failure === 'abort') return Promise.reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'))
  const url = new URL(String(input))
  return Promise.resolve(url.pathname === '/graphql' ? graphqlFailure(failure) : restFailure(failure))
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

type Handler = (request: NextRequest, context: never) => Promise<Response>

interface RouteCase {
  handler: Handler
  path: string
  context?: unknown
  body?: unknown
}

function params<T>(value: T) {
  return { params: Promise.resolve(value) }
}

const ROUTES = {
  repo: { handler: repoRoute as Handler, path: '/repo?owner=o&name=r' },
  tree: { handler: treeRoute as Handler, path: '/tree?owner=o&name=r' },
  file: { handler: fileRoute as Handler, path: '/file?owner=o&name=r&branch=main&path=src/a.ts' },
  tags: { handler: tagsRoute as Handler, path: '/tags?owner=o&name=r' },
  branches: { handler: branchesRoute as Handler, path: '/branches?owner=o&name=r' },
  commits: { handler: commitsRoute as Handler, path: '/commits?owner=o&name=r' },
  compare: { handler: compareRoute as Handler, path: '/compare?owner=o&name=r&base=v1&head=v2' },
  'commit/[sha]': { handler: commitRoute as Handler, path: '/commit/abc1234?owner=o&name=r', context: params({ sha: 'abc1234' }) },
  pulls: { handler: pullsRoute as Handler, path: '/pulls?owner=o&name=r' },
  'pulls/[number]': { handler: pullRoute as Handler, path: '/pulls/7?owner=o&name=r', context: params({ number: '7' }) },
  'pulls/[number]/files': { handler: pullFilesRoute as Handler, path: '/pulls/7/files?owner=o&name=r', context: params({ number: '7' }) },
  blame: { handler: blameRoute as Handler, path: '/blame', body: { owner: 'o', name: 'r', ref: 'main', path: 'src/a.ts' } },
} satisfies Record<string, RouteCase>
type RouteName = keyof typeof ROUTES

/** What the client sees: [status, code, message], or 'abort' when the handler rethrows the abort. */
type Observed = readonly [status: number, code: string, message: string] | 'abort'

interface Received {
  observed: Observed
  text: string
  retryAfter: string | null
}

async function receive(route: RouteCase, signal?: AbortSignal): Promise<Received> {
  const request = new NextRequest(`http://localhost/api/github${route.path}`, route.body === undefined
    ? { signal }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(route.body), signal })
  let response: Response
  try {
    response = await route.handler(request, route.context as never)
  } catch (error) {
    // jsdom's DOMException is not an Error subclass, so match by name.
    if ((error as { name?: unknown } | null)?.name === 'AbortError') return { observed: 'abort', text: '', retryAfter: null }
    throw error
  }
  const text = await response.text()
  const body = JSON.parse(text) as {
    error?: { code: string; message: string }
    failureDetails?: Array<{ message: string }>
  }
  const observed: Observed = body.error
    ? [response.status, body.error.code, body.error.message]
    : [response.status, '-', body.failureDetails?.[0]?.message ?? '-']
  return { observed, text, retryAfter: response.headers.get('Retry-After') }
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const REPO_NOT_FOUND = "Repository not found. Make sure the repository exists. If it's private, add a GitHub token in Settings."
const REPO_RATE_LIMIT = 'Rate limit exceeded. Try again later or add a GitHub Personal Access Token in Settings for higher limits.'
const RATE_LIMIT = 'Rate limit exceeded. Please try again later or add a GitHub token.'
const UNAUTHORIZED = 'Invalid or expired GitHub token. Sign in again or check your GitHub token in Settings.'
const FORBIDDEN = 'GitHub denied access. Your token may lack permission for this repository, or the organization may require you to authorize the token for SSO.'
const TIMED_OUT = 'GitHub did not respond in time. Please try again.'

/**
 * The decided status table: not_found 404 (route's code), unauthorized 401,
 * forbidden 403, GitHub rate limits (403 or 429 upstream) 403 RATE_LIMIT,
 * invalid 422, deadline 504, upstream failures 502, client abort rethrown.
 */
function contract(
  label: string,
  notFound: readonly [code: string, message: string],
  overrides: Partial<Record<Failure, Observed>> = {},
): Record<Failure, Observed> {
  const upstream = [502, 'GITHUB_ERROR', `Failed to fetch ${label}`] as const
  return {
    '404': [404, ...notFound],
    '401': [401, 'AUTH_REQUIRED', UNAUTHORIZED],
    '403-rate': [403, 'RATE_LIMIT', RATE_LIMIT],
    '403-forbidden': [403, 'FORBIDDEN', FORBIDDEN],
    '422': [422, 'VALIDATION_ERROR', `Invalid request for ${label}.`],
    '429': [403, 'RATE_LIMIT', RATE_LIMIT],
    '502': upstream,
    timeout: [504, 'GITHUB_TIMEOUT', TIMED_OUT],
    network: upstream,
    abort: 'abort',
    ...overrides,
  }
}

function partialTree(message: string): Observed {
  return [200, '-', message]
}

const EXPECTED: Record<RouteName, Record<Failure, Observed>> = {
  repo: contract('repository', ['REPO_NOT_FOUND', REPO_NOT_FOUND], {
    '403-rate': [403, 'RATE_LIMIT', REPO_RATE_LIMIT],
    '429': [403, 'RATE_LIMIT', REPO_RATE_LIMIT],
  }),
  // Tree resolution records upstream failures in a 200 partial tree.
  tree: {
    '404': partialTree('Repository tree not found.'),
    '401': partialTree(UNAUTHORIZED),
    '403-rate': partialTree(RATE_LIMIT),
    '403-forbidden': partialTree(FORBIDDEN),
    '422': partialTree('Invalid request for repository tree.'),
    '429': partialTree(RATE_LIMIT),
    '502': partialTree('Failed to fetch repository tree'),
    timeout: partialTree(TIMED_OUT),
    network: partialTree('Failed to fetch repository tree'),
    abort: 'abort',
  },
  file: contract('file', ['NOT_FOUND', 'File not found: src/a.ts']),
  tags: contract('tags', ['REPO_NOT_FOUND', 'Tags not found.']),
  branches: contract('branches', ['REPO_NOT_FOUND', 'Branches not found.']),
  commits: contract('commits', ['REPO_NOT_FOUND', 'Commits not found.']),
  compare: contract('comparison', ['REPO_NOT_FOUND', 'Comparison not found.']),
  'commit/[sha]': contract('commit detail', ['NOT_FOUND', 'Commit not found: abc1234']),
  pulls: contract('pull requests', ['REPO_NOT_FOUND', 'Pull requests not found.']),
  'pulls/[number]': contract('pull request', ['NOT_FOUND', 'Pull request #7 not found']),
  'pulls/[number]/files': contract('pull request files', ['NOT_FOUND', 'Pull request #7 not found']),
  // GraphQL: a missing repository and the primary rate limit arrive as typed errors.
  blame: contract('blame data', ['NOT_FOUND', REPO_NOT_FOUND], {
    '401': [401, 'AUTH_REQUIRED', 'Authentication required to fetch blame data'],
  }),
}

let consoleError: ReturnType<typeof vi.spyOn>
let consoleWarn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(fakeGitHub)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('GitHub proxy route error contract', () => {
  const cells = (Object.keys(ROUTES) as RouteName[]).flatMap(route =>
    FAILURES.map(upstream => ({ route, upstream })))

  it.each(cells)('$route / $upstream', async ({ route, upstream }) => {
    failure = upstream
    const controller = new AbortController()
    if (upstream === 'abort') controller.abort(new DOMException('Client disconnected', 'AbortError'))

    const received = await receive(ROUTES[route], controller.signal)

    expect(received.observed).toEqual(EXPECTED[route][upstream])
    expect(received.text, 'GitHub text must only be logged').not.toContain(UPSTREAM_SECRET)
    if (upstream === 'abort') {
      expect(consoleError, 'a client abort is not a GitHub error').not.toHaveBeenCalled()
      expect(consoleWarn, 'a client abort is not a GitHub error').not.toHaveBeenCalled()
    }
  })

  it.each(['repo', 'tags', 'blame'] as const)('%s passes the upstream reset on as Retry-After', async (route) => {
    failure = '429'
    expect((await receive(ROUTES[route])).retryAfter).toBe('60')

    failure = '403-rate'
    const reset = (await receive(ROUTES[route])).retryAfter
    // Blame's primary limit arrives as a GraphQL error without rate headers.
    if (route === 'blame') expect(reset).toBeNull()
    else expect(Number(reset)).toBeGreaterThan(0)
  })

  it('logs GitHub text server-side for a failure it reports', async () => {
    failure = '403-forbidden'
    await receive(ROUTES.tags)

    expect(consoleWarn.mock.calls.flat().map(String).join(' ')).toContain(UPSTREAM_SECRET)
  })
})
