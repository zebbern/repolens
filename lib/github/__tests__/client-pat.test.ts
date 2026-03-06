import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the memory-cache module
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

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  setGitHubPAT,
  getGitHubPAT,
  fetchRepoViaProxy,
  fetchBlameViaProxy,
} from '../client'

function mockOkResponse<T>(data: T): Response {
  return {
    ok: true,
    json: () => Promise.resolve(data),
    statusText: 'OK',
  } as unknown as Response
}

describe('PAT management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheMock.getCached.mockReturnValue(null)
    cacheMock.getStale.mockReturnValue(null)
    setGitHubPAT(null) // reset between tests
  })

  describe('setGitHubPAT / getGitHubPAT', () => {
    it('stores and retrieves a PAT', () => {
      setGitHubPAT('ghp_test123')
      expect(getGitHubPAT()).toBe('ghp_test123')
    })

    it('clears the PAT when set to null', () => {
      setGitHubPAT('ghp_test123')
      setGitHubPAT(null)
      expect(getGitHubPAT()).toBeNull()
    })
  })

  describe('proxyFetch header attachment', () => {
    it('uses Authorization Bearer when PAT is set (direct mode)', async () => {
      setGitHubPAT('ghp_test_token')
      const repoData = {
        owner: { login: 'test' }, name: 'repo', full_name: 'test/repo',
        description: null, default_branch: 'main', stargazers_count: 0,
        forks_count: 0, language: null, topics: [], private: false,
        html_url: '', size: 0, open_issues_count: 0, pushed_at: '', license: null,
      }
      mockFetch.mockResolvedValueOnce(mockOkResponse(repoData))

      await fetchRepoViaProxy('test', 'repo')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test/repo',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer ghp_test_token',
          }),
        }),
      )
    })

    it('does NOT attach X-GitHub-Token header when PAT is null', async () => {
      setGitHubPAT(null)
      const repoData = { owner: 'test', name: 'repo' }
      mockFetch.mockResolvedValueOnce(mockOkResponse(repoData))

      await fetchRepoViaProxy('test', 'repo')

      const callHeaders = mockFetch.mock.calls[0][1]?.headers ?? {}
      expect(callHeaders).not.toHaveProperty('X-GitHub-Token')
    })
  })

  describe('fetchBlameViaProxy header attachment', () => {
    it('uses Authorization Bearer for GraphQL blame when PAT is set', async () => {
      setGitHubPAT('ghp_blame_test')
      const blameData = {
        data: { repository: { object: { byteSize: 0, isTruncated: false, blame: { ranges: [] } } } },
      }
      mockFetch.mockResolvedValueOnce(mockOkResponse(blameData))

      await fetchBlameViaProxy('owner', 'repo', 'main', 'src/index.ts')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ghp_blame_test',
          }),
        }),
      )
    })

    it('omits X-GitHub-Token when PAT is null for blame', async () => {
      setGitHubPAT(null)
      const blameData = { ranges: [] }
      mockFetch.mockResolvedValueOnce(mockOkResponse(blameData))

      await fetchBlameViaProxy('owner', 'repo', 'main', 'src/index.ts')

      const callHeaders = mockFetch.mock.calls[0][1]?.headers ?? {}
      expect(callHeaders).not.toHaveProperty('X-GitHub-Token')
      expect(callHeaders).toHaveProperty('Content-Type', 'application/json')
    })
  })
})
