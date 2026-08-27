import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock memory-cache (hoisted — same pattern as client.test.ts)
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

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  fetchTagsViaProxy,
  fetchBranchesViaProxy,
  fetchCommitsViaProxy,
  fetchCompareViaProxy,
} from '../client'

/** Create a successful Response-like object for mockFetch */
function mockOkResponse<T>(data: T): Response {
  return {
    ok: true,
    json: () => Promise.resolve(data),
    statusText: 'OK',
  } as unknown as Response
}

function mockErrorResponse(status: number, body: object): Response {
  return {
    ok: false,
    statusText: `Error ${status}`,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHub client — changelog proxy functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheMock.getCached.mockReturnValue(null)
    cacheMock.getStale.mockReturnValue(null)
  })

  // -----------------------------------------------------------------------
  // fetchTagsViaProxy
  // -----------------------------------------------------------------------

  describe('fetchTagsViaProxy', () => {
    it('calls the correct proxy URL with owner and name', async () => {
      const tags = [{ name: 'v1.0.0', commitSha: 'abc' }]
      mockFetch.mockResolvedValueOnce(mockOkResponse(tags))

      const result = await fetchTagsViaProxy('facebook', 'react')

      expect(result).toEqual(tags)
      expect(mockFetch).toHaveBeenCalledOnce()
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('/api/github/tags')
      expect(url).toContain('owner=facebook')
      expect(url).toContain('name=react')
    })

    it('includes per_page when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchTagsViaProxy('o', 'r', 50)

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('per_page=50')
    })

    it('omits per_page when not provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchTagsViaProxy('o', 'r')

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).not.toContain('per_page')
    })

    it('uses tags cache key prefix', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchTagsViaProxy('owner', 'repo')

      expect(cacheMock.getCached).toHaveBeenCalledWith(expect.stringMatching(/^tags:owner\/repo:30:principal:(?:anonymous|pat:\d+|oauth:[^:]+):epoch:\d+$/))
    })

    it('uses 10-minute (600,000ms) TTL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchTagsViaProxy('o', 'r')

      expect(cacheMock.setCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        600_000,
      )
    })

    it('returns typed GitHubTag[]', async () => {
      const tags = [
        { name: 'v1.0.0', commitSha: 'abc', commitUrl: '', tarballUrl: '', zipballUrl: '' },
      ]
      mockFetch.mockResolvedValueOnce(mockOkResponse(tags))

      const result = await fetchTagsViaProxy('o', 'r')

      expect(Array.isArray(result)).toBe(true)
      expect(result[0].name).toBe('v1.0.0')
    })
  })

  // -----------------------------------------------------------------------
  // fetchBranchesViaProxy
  // -----------------------------------------------------------------------

  describe('fetchBranchesViaProxy', () => {
    it('calls the correct proxy URL', async () => {
      const branches = [{ name: 'main', commitSha: 'abc', isProtected: true }]
      mockFetch.mockResolvedValueOnce(mockOkResponse(branches))

      const result = await fetchBranchesViaProxy('facebook', 'react')

      expect(result).toEqual(branches)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('/api/github/branches')
      expect(url).toContain('owner=facebook')
      expect(url).toContain('name=react')
    })

    it('includes per_page when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchBranchesViaProxy('o', 'r', 100)

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('per_page=100')
    })

    it('uses branches cache key prefix', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchBranchesViaProxy('owner', 'repo')

      expect(cacheMock.getCached).toHaveBeenCalledWith(expect.stringMatching(/^branches:owner\/repo:30:principal:(?:anonymous|pat:\d+|oauth:[^:]+):epoch:\d+$/))
    })

    it('uses 5-minute (300,000ms) TTL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchBranchesViaProxy('o', 'r')

      expect(cacheMock.setCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        300_000,
      )
    })
  })

  // -----------------------------------------------------------------------
  // fetchCommitsViaProxy
  // -----------------------------------------------------------------------

  describe('fetchCommitsViaProxy', () => {
    it('calls the correct proxy URL with owner and name', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchCommitsViaProxy('o', 'r')

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('/api/github/commits')
      expect(url).toContain('owner=o')
      expect(url).toContain('name=r')
    })

    it('includes optional sha param when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchCommitsViaProxy('o', 'r', { sha: 'main' })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('sha=main')
    })

    it('includes optional since param when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchCommitsViaProxy('o', 'r', { since: '2025-01-01T00:00:00Z' })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('since=')
    })

    it('includes optional until param when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchCommitsViaProxy('o', 'r', { until: '2025-06-01T00:00:00Z' })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('until=')
    })

    it('includes perPage when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchCommitsViaProxy('o', 'r', { perPage: 50 })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('per_page=50')
    })

    it('omits optional params when not provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchCommitsViaProxy('o', 'r')

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).not.toContain('sha=')
      expect(url).not.toContain('since=')
      expect(url).not.toContain('until=')
      expect(url).not.toContain('per_page=')
    })

    it('uses commits cache key prefix including params', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchCommitsViaProxy('owner', 'repo', { sha: 'main' })

      // The cache key includes the full params string
      const cacheKey = cacheMock.getCached.mock.calls[0][0] as string
      expect(cacheKey).toContain('commits:owner/repo:')
    })

    it('uses 5-minute (300,000ms) TTL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchCommitsViaProxy('o', 'r')

      expect(cacheMock.setCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        300_000,
      )
    })
  })

  // -----------------------------------------------------------------------
  // fetchCompareViaProxy
  // -----------------------------------------------------------------------

  describe('fetchCompareViaProxy', () => {
    it('calls the correct proxy URL with base and head', async () => {
      const comparison = { status: 'ahead', aheadBy: 2, behindBy: 0, totalCommits: 2, commits: [], files: [] }
      mockFetch.mockResolvedValueOnce(mockOkResponse(comparison))

      const result = await fetchCompareViaProxy('o', 'r', 'v1.0', 'v2.0')

      expect(result).toEqual(comparison)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('/api/github/compare')
      expect(url).toContain('owner=o')
      expect(url).toContain('name=r')
      expect(url).toContain('base=v1.0')
      expect(url).toContain('head=v2.0')
    })

    it('uses compare cache key with base...head', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({}))

      await fetchCompareViaProxy('owner', 'repo', 'v1', 'v2')

      expect(cacheMock.getCached).toHaveBeenCalledWith(expect.stringMatching(/^compare:owner\/repo:v1\.\.\.v2:principal:(?:anonymous|pat:\d+|oauth:[^:]+):epoch:\d+$/))
    })

    it('uses 10-minute (600,000ms) TTL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({}))

      await fetchCompareViaProxy('o', 'r', 'a', 'b')

      expect(cacheMock.setCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        600_000,
      )
    })

    it('throws on fetch error', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, { error: 'Server error' }))

      await expect(fetchCompareViaProxy('o', 'r', 'a', 'b')).rejects.toThrow('Server error')
    })
  })
})
