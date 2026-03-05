import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the memory-cache module — vi.mock is hoisted, so use vi.hoisted()
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
  fetchRepoViaProxy,
  fetchTreeViaProxy,
  fetchFileViaProxy,
  fetchRateLimitViaProxy,
  clearGitHubCache,
  invalidateRepoCache,
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

describe('GitHub client — caching integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: cache miss (no fresh, no stale)
    cacheMock.getCached.mockReturnValue(null)
    cacheMock.getStale.mockReturnValue(null)
  })

  // -----------------------------------------------------------------------
  // Cache miss → fetch → cache
  // -----------------------------------------------------------------------

  describe('cache miss', () => {
    it('fetches from API and caches the result on a miss', async () => {
      const repoData = { owner: 'facebook', name: 'react', stars: 200000 }
      mockFetch.mockResolvedValueOnce(mockOkResponse(repoData))

      const result = await fetchRepoViaProxy('facebook', 'react')

      expect(result).toEqual(repoData)
      expect(mockFetch).toHaveBeenCalledOnce()
      expect(cacheMock.setCache).toHaveBeenCalledWith(
        'repo:facebook/react',
        repoData,
        300_000, // 5 min TTL
      )
    })

    it('passes error through when fetch fails on a miss', async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(404, { error: 'Repository not found' }),
      )

      await expect(fetchRepoViaProxy('owner', 'missing')).rejects.toThrow(
        'Repository not found',
      )
    })
  })

  // -----------------------------------------------------------------------
  // Cache hit — return cached without fetching
  // -----------------------------------------------------------------------

  describe('cache hit', () => {
    it('returns fresh cached data without calling fetch', async () => {
      const cachedData = { owner: 'facebook', name: 'react' }
      cacheMock.getCached.mockReturnValueOnce(cachedData)

      const result = await fetchRepoViaProxy('facebook', 'react')

      expect(result).toEqual(cachedData)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Stale-while-revalidate
  // -----------------------------------------------------------------------

  describe('stale-while-revalidate', () => {
    it('returns stale data immediately and revalidates in the background', async () => {
      const staleData = { owner: 'stale', name: 'repo' }
      const freshData = { owner: 'fresh', name: 'repo' }

      cacheMock.getCached.mockReturnValueOnce(null) // no fresh hit
      cacheMock.getStale.mockReturnValueOnce({ data: staleData, isStale: true })
      mockFetch.mockResolvedValueOnce(mockOkResponse(freshData))

      const result = await fetchRepoViaProxy('stale', 'repo')

      // Should return stale data immediately
      expect(result).toEqual(staleData)

      // Background revalidation: wait for microtask queue to flush
      await vi.waitFor(() => {
        expect(cacheMock.setCache).toHaveBeenCalledWith(
          'repo:stale/repo',
          freshData,
          300_000,
        )
      })
    })
  })

  // -----------------------------------------------------------------------
  // TTL values per function
  // -----------------------------------------------------------------------

  describe('correct TTL per function', () => {
    it('fetchRepoViaProxy uses 5-minute (300,000ms) TTL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({ name: 'test' }))
      await fetchRepoViaProxy('owner', 'repo')
      expect(cacheMock.setCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        300_000,
      )
    })

    it('fetchTreeViaProxy uses 10-minute (600,000ms) TTL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({ tree: [] }))
      await fetchTreeViaProxy('owner', 'repo', 'sha123')
      expect(cacheMock.setCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        600_000,
      )
    })

    it('fetchFileViaProxy uses 10-minute (600,000ms) TTL', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOkResponse({ content: 'file contents' }),
      )
      await fetchFileViaProxy('owner', 'repo', 'main', 'README.md')
      expect(cacheMock.setCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        600_000,
      )
    })

    it('fetchRateLimitViaProxy uses 30-second (30,000ms) TTL', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOkResponse({ limit: 60, remaining: 59, reset: 0, authenticated: false }),
      )
      await fetchRateLimitViaProxy()
      expect(cacheMock.setCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        30_000,
      )
    })
  })

  // -----------------------------------------------------------------------
  // Cache key namespacing
  // -----------------------------------------------------------------------

  describe('cache key namespacing', () => {
    it('repo key uses "repo:" prefix', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({}))
      await fetchRepoViaProxy('facebook', 'react')
      expect(cacheMock.getCached).toHaveBeenCalledWith('repo:facebook/react')
    })

    it('tree key includes SHA', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({}))
      await fetchTreeViaProxy('facebook', 'react', 'abc123')
      expect(cacheMock.getCached).toHaveBeenCalledWith('tree:facebook/react:abc123')
    })

    it('file key includes branch and path', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({ content: '' }))
      await fetchFileViaProxy('owner', 'repo', 'main', 'src/index.ts')
      expect(cacheMock.getCached).toHaveBeenCalledWith('file:owner/repo:main:src/index.ts')
    })

    it('rate-limit key is a constant string', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOkResponse({ limit: 60, remaining: 59, reset: 0, authenticated: false }),
      )
      await fetchRateLimitViaProxy()
      expect(cacheMock.getCached).toHaveBeenCalledWith('rate-limit')
    })
  })

  // -----------------------------------------------------------------------
  // Cache management helpers
  // -----------------------------------------------------------------------

  describe('clearGitHubCache', () => {
    it('delegates to clearCache from memory-cache', () => {
      clearGitHubCache()
      expect(cacheMock.clearCache).toHaveBeenCalledOnce()
    })
  })

  describe('invalidateRepoCache', () => {
    it('invalidates repo, tree, file, tags, branches, commits, compare, blame, commit-detail, and file-commits patterns for the given owner/repo', () => {
      invalidateRepoCache('facebook', 'react')

      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('repo:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('tree:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('file:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('tags:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('branches:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('commits:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('compare:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('blame:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('commit-detail:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('file-commits:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledTimes(10)
    })
  })

  // -----------------------------------------------------------------------
  // fetchFileViaProxy unwraps { content } wrapper
  // -----------------------------------------------------------------------

  describe('fetchFileViaProxy content unwrapping', () => {
    it('returns the content string from the { content } wrapper', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOkResponse({ content: 'export const x = 1;' }),
      )

      const result = await fetchFileViaProxy('owner', 'repo', 'main', 'index.ts')
      expect(result).toBe('export const x = 1;')
    })
  })

  // -----------------------------------------------------------------------
  // Error message parsing
  // -----------------------------------------------------------------------

  describe('error message parsing', () => {
    it('extracts string error from response body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(403, { error: 'Rate limit exceeded' }),
      )

      await expect(fetchRepoViaProxy('a', 'b')).rejects.toThrow('Rate limit exceeded')
    })

    it('extracts nested error.message from response body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(500, { error: { message: 'Internal server error' } }),
      )

      await expect(fetchRepoViaProxy('a', 'b')).rejects.toThrow('Internal server error')
    })

    it('falls back to statusText when body has no error field', async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(502, {}),
      )

      await expect(fetchRepoViaProxy('a', 'b')).rejects.toThrow('Request failed: Error 502')
    })
  })
})
