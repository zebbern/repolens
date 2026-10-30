import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GitHubError } from '@/lib/github/errors'

// An upstream/internal failure detail that must never reach the client.
const SECRET = 'connect ECONNREFUSED 10.0.0.7:443 internal-upstream-detail'

const { failure, rejectWithSecret } = vi.hoisted(() => {
  const failure = {
    create: (): unknown => new Error('connect ECONNREFUSED 10.0.0.7:443 internal-upstream-detail'),
  }
  return { failure, rejectWithSecret: () => Promise.reject(failure.create()) }
})

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: () => Promise.resolve('gho_server_token'),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: () => null,
  refundRateLimit: () => {},
}))

vi.mock('@/lib/github/fetcher', () => ({
  GitHubResponseTooLargeError: class GitHubResponseTooLargeError extends Error {},
  fetchRepoMetadata: rejectWithSecret,
  fetchRepoTree: rejectWithSecret,
  fetchFileContent: rejectWithSecret,
  fetchTags: rejectWithSecret,
  fetchBranches: rejectWithSecret,
  fetchCommits: rejectWithSecret,
  fetchCompare: rejectWithSecret,
  fetchCommitDetail: rejectWithSecret,
  fetchBlame: rejectWithSecret,
  fetchPulls: rejectWithSecret,
  fetchPullRequest: rejectWithSecret,
  fetchPullRequestFiles: rejectWithSecret,
}))

type RouteHandler = (request: NextRequest, context?: unknown) => Promise<Response>

interface RouteCase {
  name: string
  load: () => Promise<RouteHandler>
  request: () => NextRequest
  context?: unknown
}

const BASE = 'http://localhost/api/github'

function get(path: string): () => NextRequest {
  return () => new NextRequest(`${BASE}${path}`)
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): () => NextRequest {
  return () => new NextRequest(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const ROUTES: RouteCase[] = [
  { name: 'repo', load: async () => (await import('../repo/route')).GET, request: get('/repo?owner=o&name=r') },
  { name: 'tree', load: async () => (await import('../tree/route')).GET, request: get('/tree?owner=o&name=r') },
  { name: 'file', load: async () => (await import('../file/route')).GET, request: get('/file?owner=o&name=r&branch=main&path=a.ts') },
  { name: 'tags', load: async () => (await import('../tags/route')).GET, request: get('/tags?owner=o&name=r') },
  { name: 'branches', load: async () => (await import('../branches/route')).GET, request: get('/branches?owner=o&name=r') },
  { name: 'commits', load: async () => (await import('../commits/route')).GET, request: get('/commits?owner=o&name=r') },
  { name: 'compare', load: async () => (await import('../compare/route')).GET, request: get('/compare?owner=o&name=r&base=v1&head=v2') },
  {
    name: 'commit/[sha]',
    load: async () => (await import('../commit/[sha]/route')).GET as RouteHandler,
    request: get('/commit/abc1234?owner=o&name=r'),
    context: { params: Promise.resolve({ sha: 'abc1234' }) },
  },
  { name: 'pulls', load: async () => (await import('../pulls/route')).GET, request: get('/pulls?owner=o&name=r') },
  {
    name: 'pulls/[number]',
    load: async () => (await import('../pulls/[number]/route')).GET as RouteHandler,
    request: get('/pulls/1?owner=o&name=r'),
    context: { params: Promise.resolve({ number: '1' }) },
  },
  {
    name: 'pulls/[number]/files',
    load: async () => (await import('../pulls/[number]/files/route')).GET as RouteHandler,
    request: get('/pulls/1/files?owner=o&name=r'),
    context: { params: Promise.resolve({ number: '1' }) },
  },
  {
    name: 'validate-token',
    load: async () => (await import('../validate-token/route')).POST,
    request: post('/validate-token', {}, { 'X-GitHub-Token': 'ghp_abc123' }),
  },
  {
    name: 'blame',
    load: async () => (await import('../blame/route')).POST,
    request: post('/blame', { owner: 'o', name: 'r', ref: 'main', path: 'a.ts' }),
  },
  {
    name: 'zipball',
    load: async () => (await import('../zipball/route')).POST,
    request: post('/zipball', { owner: 'o', repo: 'r', ref: 'main' }),
  },
]

describe('GitHub proxy routes do not leak raw exception text', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Routes that call GitHub directly (validate-token, zipball) hit fetch.
    vi.stubGlobal('fetch', vi.fn(rejectWithSecret))
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
    vi.unstubAllGlobals()
  })

  it.each(ROUTES.map(route => [route.name, route] as const))(
    '%s returns a generic 5xx message and logs the detail server-side',
    async (_name, route) => {
      const handler = await route.load()
      const response = await handler(route.request(), route.context)
      const text = await response.text()

      expect(response.status).toBeGreaterThanOrEqual(500)
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain('ECONNREFUSED')
      expect(JSON.parse(text).error.message).toEqual(expect.any(String))
      expect(consoleError.mock.calls.flat().map(String).join(' ')).toContain(SECRET)
    },
  )
})

describe('GitHub proxy routes keep upstream text of a GitHubError server-side', () => {
  /** Routes whose GitHub failures come from lib/github/fetcher.ts. */
  const FETCHER_ROUTES = ROUTES.filter(route => !['validate-token', 'zipball'].includes(route.name))
  const createSecretError = () => new Error(SECRET)
  let consoleWarn: ReturnType<typeof vi.spyOn>
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    failure.create = createSecretError
    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })

  it.each(FETCHER_ROUTES.map(route => [route.name, route] as const))(
    '%s returns the table message for a 4xx GitHubError and logs the upstream text',
    async (_name, route) => {
      failure.create = () => new GitHubError('forbidden', { resource: 'repository', upstreamStatus: 403, upstreamMessage: SECRET })
      const handler = await route.load()
      const response = await handler(route.request(), route.context)
      const text = await response.text()

      expect(response.status).toBe(403)
      expect(JSON.parse(text).error).toEqual({ code: 'FORBIDDEN', message: expect.any(String) })
      expect(text).not.toContain(SECRET)
      expect(consoleWarn.mock.calls.flat().map(String).join(' ')).toContain(SECRET)
    },
  )
})
