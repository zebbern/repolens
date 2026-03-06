import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { cacheMock } = vi.hoisted(() => ({
  cacheMock: {
    getCached: vi.fn(),
    getStale: vi.fn(),
    setCache: vi.fn(),
    clearCache: vi.fn(),
    invalidatePattern: vi.fn(),
  },
}))

vi.mock('@/lib/cache/memory-cache', () => cacheMock)

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  setGitHubPAT,
  fetchRepoViaProxy,
  fetchTreeViaProxy,
  fetchFileViaProxy,
  fetchTagsViaProxy,
  fetchBranchesViaProxy,
  fetchCommitsViaProxy,
  fetchCompareViaProxy,
  fetchCommitDetailViaProxy,
  fetchRateLimitViaProxy,
  fetchBlameViaProxy,
} from './client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response
}

function textResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Fixtures — raw GitHub API response shapes
// ---------------------------------------------------------------------------

const RAW_REPO = {
  owner: { login: 'facebook' },
  name: 'react',
  full_name: 'facebook/react',
  description: 'A JS library',
  default_branch: 'main',
  stargazers_count: 200000,
  forks_count: 40000,
  language: 'JavaScript',
  topics: ['ui', 'frontend'],
  private: false,
  html_url: 'https://github.com/facebook/react',
  size: 300000,
  open_issues_count: 800,
  pushed_at: '2026-01-15T00:00:00Z',
  license: { spdx_id: 'MIT' },
}

const RAW_TAGS = [
  {
    name: 'v18.0.0',
    commit: { sha: 'abc123', url: 'https://api.github.com/repos/X/Y/commits/abc123' },
    tarball_url: 'https://api.github.com/repos/X/Y/tarball/v18.0.0',
    zipball_url: 'https://api.github.com/repos/X/Y/zipball/v18.0.0',
  },
]

const RAW_BRANCHES = [
  { name: 'main', commit: { sha: 'def456' }, protected: true },
  { name: 'dev', commit: { sha: 'ghi789' }, protected: false },
]

const RAW_COMMITS = [
  {
    sha: 'commit1',
    commit: {
      message: 'fix: something',
      author: { name: 'Alice', email: 'alice@test.com', date: '2026-01-01T00:00:00Z' },
      committer: { name: 'Alice', date: '2026-01-01T00:00:00Z' },
    },
    html_url: 'https://github.com/X/Y/commit/commit1',
    author: { login: 'alice', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
    parents: [{ sha: 'parent1' }],
  },
]

const RAW_COMPARE = {
  status: 'ahead',
  ahead_by: 3,
  behind_by: 0,
  total_commits: 3,
  commits: RAW_COMMITS,
  files: [
    { filename: 'src/index.ts', status: 'modified', additions: 10, deletions: 2, changes: 12, patch: '@@ -1,2 +1,10 @@' },
  ],
}

const RAW_COMMIT_DETAIL = {
  sha: 'abc123',
  commit: {
    message: 'fix: detail',
    author: { name: 'Bob', email: 'bob@test.com', date: '2026-02-01T00:00:00Z' },
    committer: { name: 'Bob', date: '2026-02-01T00:00:00Z' },
  },
  html_url: 'https://github.com/X/Y/commit/abc123',
  author: { login: 'bob', avatar_url: 'https://avatars.githubusercontent.com/u/2' },
  parents: [],
  stats: { additions: 5, deletions: 1, total: 6 },
  files: [{ filename: 'src/app.ts', status: 'modified', additions: 5, deletions: 1, changes: 6, patch: '@@ -1 +1,5 @@' }],
}

const RAW_RATE_LIMIT = {
  rate: { limit: 5000, remaining: 4999, reset: 1700000000 },
}

const RAW_BLAME_GRAPHQL = {
  data: {
    repository: {
      object: {
        byteSize: 1024,
        isTruncated: false,
        blame: {
          ranges: [{
            startingLine: 1, endingLine: 5, age: 30,
            commit: {
              oid: 'abc123', abbreviatedOid: 'abc1', message: 'initial commit',
              messageHeadline: 'initial commit', committedDate: '2026-01-01T00:00:00Z',
              url: 'https://github.com/X/Y/commit/abc123',
              author: { name: 'Alice', email: 'alice@test.com', date: '2026-01-01T00:00:00Z', user: { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' } },
            },
          }],
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Direct GitHub API calls (PAT mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheMock.getCached.mockReturnValue(null)
    cacheMock.getStale.mockReturnValue(null)
    setGitHubPAT(null)
  })

  describe('URL mapping via proxyFetch', () => {
    beforeEach(() => { setGitHubPAT('ghp_test') })

    it('maps repo endpoint to GitHub API', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_REPO))
      await fetchRepoViaProxy('facebook', 'react')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/facebook/react', expect.any(Object))
    })

    it('maps tree endpoint to GitHub API', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'abc', tree: [], truncated: false }))
      await fetchTreeViaProxy('X', 'Y', 'abc123')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/X/Y/git/trees/abc123?recursive=1', expect.any(Object))
    })

    it('maps file endpoint to raw.githubusercontent.com', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('console.log("hi")'))
      await fetchFileViaProxy('X', 'Y', 'main', 'src/index.ts')
      expect(mockFetch).toHaveBeenCalledWith('https://raw.githubusercontent.com/X/Y/main/src/index.ts', expect.any(Object))
    })

    it('maps tags endpoint with per_page', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_TAGS))
      await fetchTagsViaProxy('X', 'Y', 10)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('https://api.github.com/repos/X/Y/tags')
      expect(url).toContain('per_page=10')
    })

    it('maps branches endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_BRANCHES))
      await fetchBranchesViaProxy('X', 'Y')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/X/Y/branches', expect.any(Object))
    })

    it('maps commits endpoint with query params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_COMMITS))
      await fetchCommitsViaProxy('X', 'Y', { sha: 'main', perPage: 30 })
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/X\/Y\/commits/)
      expect(url).toContain('sha=main')
      expect(url).toContain('per_page=30')
    })

    it('maps compare endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_COMPARE))
      await fetchCompareViaProxy('X', 'Y', 'v1', 'v2')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/X/Y/compare/v1...v2', expect.any(Object))
    })

    it('maps commit detail endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_COMMIT_DETAIL))
      await fetchCommitDetailViaProxy('X', 'Y', 'abc123')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/X/Y/commits/abc123', expect.any(Object))
    })

    it('maps rate-limit endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_RATE_LIMIT))
      await fetchRateLimitViaProxy()
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/rate_limit', expect.any(Object))
    })
  })

  describe('Path selection (PAT vs no PAT)', () => {
    it('uses direct GitHub API URL when PAT is set', async () => {
      setGitHubPAT('ghp_direct')
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_REPO))
      await fetchRepoViaProxy('facebook', 'react')
      expect((mockFetch.mock.calls[0][0] as string)).toBe('https://api.github.com/repos/facebook/react')
    })

    it('uses proxy URL when no PAT is set', async () => {
      setGitHubPAT(null)
      mockFetch.mockResolvedValueOnce(jsonResponse({ owner: 'fb', name: 'react' }))
      await fetchRepoViaProxy('facebook', 'react')
      expect((mockFetch.mock.calls[0][0] as string)).toMatch(/^\/api\/github\/repo/)
    })

    it('sends Authorization Bearer header in direct mode', async () => {
      setGitHubPAT('ghp_mytoken')
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_TAGS))
      await fetchTagsViaProxy('X', 'Y')
      const headers = mockFetch.mock.calls[0][1]?.headers ?? {}
      expect(headers).toHaveProperty('Authorization', 'Bearer ghp_mytoken')
      expect(headers).not.toHaveProperty('X-GitHub-Token')
    })

    it('sends no auth headers when no PAT (proxy mode)', async () => {
      setGitHubPAT(null)
      mockFetch.mockResolvedValueOnce(jsonResponse({ owner: 'X', name: 'Y' }))
      await fetchRepoViaProxy('X', 'Y')
      const headers = mockFetch.mock.calls[0][1]?.headers ?? {}
      expect(headers).not.toHaveProperty('Authorization')
    })
  })

  describe('Error handling (direct mode)', () => {
    beforeEach(() => { setGitHubPAT('ghp_errors') })

    it('throws descriptive error for 404', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))
      await expect(fetchRepoViaProxy('X', 'missing')).rejects.toThrow('Not Found')
    })

    it('throws rate-limit error for 403', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'API rate limit exceeded' }, 403))
      await expect(fetchRepoViaProxy('X', 'Y')).rejects.toThrow('Rate limit exceeded')
    })

    it('throws generic error for 500', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'Internal Server Error' }, 500))
      await expect(fetchRepoViaProxy('X', 'Y')).rejects.toThrow('Internal Server Error')
    })

    it('throws default message when error body has no message', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway', json: () => Promise.resolve({}) } as unknown as Response)
      await expect(fetchRepoViaProxy('X', 'Y')).rejects.toThrow('Request failed: Bad Gateway')
    })

    it('throws for 404 on raw file fetch', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('', 404))
      await expect(fetchFileViaProxy('X', 'Y', 'main', 'missing.ts')).rejects.toThrow('File not found')
    })
  })

  describe('Blame direct path', () => {
    it('POSTs to GraphQL endpoint when PAT is available', async () => {
      setGitHubPAT('ghp_blame')
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_BLAME_GRAPHQL))
      await fetchBlameViaProxy('X', 'Y', 'main', 'src/index.ts')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/graphql', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Authorization': 'Bearer ghp_blame', 'Content-Type': 'application/json' }) }))
    })

    it('POSTs to proxy route when no PAT', async () => {
      setGitHubPAT(null)
      mockFetch.mockResolvedValueOnce(jsonResponse({ ranges: [], isTruncated: false, byteSize: 0 }))
      await fetchBlameViaProxy('X', 'Y', 'main', 'src/index.ts')
      expect(mockFetch).toHaveBeenCalledWith('/api/github/blame', expect.objectContaining({ method: 'POST' }))
    })

    it('includes correct query and variables in GraphQL request', async () => {
      setGitHubPAT('ghp_gql')
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_BLAME_GRAPHQL))
      await fetchBlameViaProxy('owner', 'repo', 'main', 'src/app.ts')
      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string)
      expect(body.variables).toEqual({ owner: 'owner', name: 'repo', expression: 'main:src/app.ts' })
      expect(body.query).toContain('query BlameData')
    })

    it('returns parsed blame data from GraphQL', async () => {
      setGitHubPAT('ghp_gql')
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_BLAME_GRAPHQL))
      const result = await fetchBlameViaProxy('X', 'Y', 'main', 'src/index.ts')
      expect(result.ranges).toHaveLength(1)
      expect(result.byteSize).toBe(1024)
      expect(result.isTruncated).toBe(false)
    })

    it('throws when GraphQL response has errors', async () => {
      setGitHubPAT('ghp_gql')
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: {}, errors: [{ message: 'Bad query' }] }))
      await expect(fetchBlameViaProxy('X', 'Y', 'main', 'bad.ts')).rejects.toThrow('Bad query')
    })

    it('throws when blob is null (file not found)', async () => {
      setGitHubPAT('ghp_gql')
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: { repository: { object: null } } }))
      await expect(fetchBlameViaProxy('X', 'Y', 'main', 'missing.ts')).rejects.toThrow('File not found: missing.ts')
    })

    it('throws on 401 for blame', async () => {
      setGitHubPAT('ghp_expired')
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', json: () => Promise.resolve({}) } as unknown as Response)
      await expect(fetchBlameViaProxy('X', 'Y', 'main', 'file.ts')).rejects.toThrow('Authentication required')
    })
  })

  describe('Response normalization', () => {
    beforeEach(() => { setGitHubPAT('ghp_norm') })

    it('normalizes repo metadata', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_REPO))
      const result = await fetchRepoViaProxy('facebook', 'react')
      expect(result).toEqual({
        owner: 'facebook', name: 'react', fullName: 'facebook/react',
        description: 'A JS library', defaultBranch: 'main', stars: 200000,
        forks: 40000, language: 'JavaScript', topics: ['ui', 'frontend'],
        isPrivate: false, url: 'https://github.com/facebook/react',
        size: 300000, openIssuesCount: 800, pushedAt: '2026-01-15T00:00:00Z', license: 'MIT',
      })
    })

    it('normalizes tags', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_TAGS))
      const result = await fetchTagsViaProxy('X', 'Y')
      expect(result[0]).toEqual({
        name: 'v18.0.0', commitSha: 'abc123',
        commitUrl: 'https://api.github.com/repos/X/Y/commits/abc123',
        tarballUrl: 'https://api.github.com/repos/X/Y/tarball/v18.0.0',
        zipballUrl: 'https://api.github.com/repos/X/Y/zipball/v18.0.0',
      })
    })

    it('normalizes branches', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_BRANCHES))
      const result = await fetchBranchesViaProxy('X', 'Y')
      expect(result).toEqual([
        { name: 'main', commitSha: 'def456', isProtected: true },
        { name: 'dev', commitSha: 'ghi789', isProtected: false },
      ])
    })

    it('normalizes commits', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_COMMITS))
      const result = await fetchCommitsViaProxy('X', 'Y')
      expect(result[0]).toMatchObject({ sha: 'commit1', message: 'fix: something', authorName: 'Alice', authorLogin: 'alice' })
    })

    it('wraps raw file content as { content }', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('export const x = 1'))
      const result = await fetchFileViaProxy('X', 'Y', 'main', 'src/index.ts')
      expect(result).toBe('export const x = 1')
    })

    it('normalizes rate-limit with authenticated: true', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_RATE_LIMIT))
      const result = await fetchRateLimitViaProxy()
      expect(result).toEqual({ limit: 5000, remaining: 4999, reset: 1700000000, authenticated: true })
    })

    it('normalizes compare response', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_COMPARE))
      const result = await fetchCompareViaProxy('X', 'Y', 'v1', 'v2')
      expect(result.status).toBe('ahead')
      expect(result.aheadBy).toBe(3)
      expect(result.commits).toHaveLength(1)
      expect(result.files[0].filename).toBe('src/index.ts')
    })

    it('normalizes commit detail', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(RAW_COMMIT_DETAIL))
      const result = await fetchCommitDetailViaProxy('X', 'Y', 'abc123')
      expect(result.sha).toBe('abc123')
      expect(result.stats).toEqual({ additions: 5, deletions: 1, total: 6 })
      expect(result.files[0].filename).toBe('src/app.ts')
    })
  })
})
