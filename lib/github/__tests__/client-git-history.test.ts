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
  fetchBlameViaProxy,
  fetchFileCommitsViaProxy,
  fetchCommitDetailViaProxy,
  invalidateRepoCache,
} from '../client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

describe('GitHub client — git history proxy functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheMock.getCached.mockReturnValue(null)
    cacheMock.getStale.mockReturnValue(null)
  })

  // -----------------------------------------------------------------------
  // fetchBlameViaProxy
  // -----------------------------------------------------------------------

  describe('fetchBlameViaProxy', () => {
    it('POSTs to /api/github/blame and caches the result', async () => {
      const blameData = {
        ranges: [],
        isTruncated: false,
        byteSize: 128,
      }
      mockFetch.mockResolvedValueOnce(mockOkResponse(blameData))

      const result = await fetchBlameViaProxy('facebook', 'react', 'main', 'src/index.ts')

      expect(result).toEqual(blameData)
      expect(mockFetch).toHaveBeenCalledWith('/api/github/blame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: 'facebook',
          name: 'react',
          ref: 'main',
          path: 'src/index.ts',
        }),
      })
      expect(cacheMock.setCache).toHaveBeenCalledWith(
        'blame:facebook/react:main:src/index.ts',
        blameData,
        600_000,
      )
    })

    it('returns fresh cached data without calling fetch', async () => {
      const cachedBlame = { ranges: [], isTruncated: false, byteSize: 64 }
      cacheMock.getCached.mockReturnValueOnce(cachedBlame)

      const result = await fetchBlameViaProxy('owner', 'repo', 'main', 'file.ts')

      expect(result).toEqual(cachedBlame)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('throws error on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(401, { error: 'Authentication required' }),
      )

      await expect(
        fetchBlameViaProxy('owner', 'repo', 'main', 'file.ts'),
      ).rejects.toThrow('Authentication required')
    })
  })

  // -----------------------------------------------------------------------
  // fetchFileCommitsViaProxy
  // -----------------------------------------------------------------------

  describe('fetchFileCommitsViaProxy', () => {
    it('fetches commits for a specific file path', async () => {
      const commits = [
        {
          sha: 'abc123',
          message: 'update',
          authorName: 'Jane',
          authorEmail: 'jane@x.com',
          authorDate: '2025-01-15T10:00:00Z',
          committerName: 'Jane',
          committerDate: '2025-01-15T10:00:00Z',
          url: 'https://example.com/commit/abc123',
          authorLogin: 'jane',
          authorAvatarUrl: null,
          parents: [],
        },
      ]
      mockFetch.mockResolvedValueOnce(mockOkResponse(commits))

      const result = await fetchFileCommitsViaProxy('facebook', 'react', 'src/index.ts')

      expect(result).toEqual(commits)
      // Verify fetch URL includes the path parameter
      const fetchUrl = mockFetch.mock.calls[0][0] as string
      expect(fetchUrl).toContain('/api/github/commits?')
      expect(fetchUrl).toContain('path=src%2Findex.ts')
    })

    it('uses correct cache key with file-commits prefix', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([]))

      await fetchFileCommitsViaProxy('owner', 'repo', 'README.md')

      expect(cacheMock.getCached).toHaveBeenCalledWith(
        expect.stringContaining('file-commits:owner/repo:README.md'),
      )
    })
  })

  // -----------------------------------------------------------------------
  // fetchCommitDetailViaProxy
  // -----------------------------------------------------------------------

  describe('fetchCommitDetailViaProxy', () => {
    it('fetches commit detail via the proxy route', async () => {
      const detail = {
        sha: 'abc123',
        message: 'feat: something',
        authorName: 'Jane',
        authorEmail: 'jane@x.com',
        authorDate: '2025-01-15T10:00:00Z',
        committerName: 'GitHub',
        committerDate: '2025-01-15T10:00:00Z',
        url: 'https://github.com/owner/repo/commit/abc123',
        authorLogin: 'jane',
        authorAvatarUrl: null,
        parents: [],
        stats: { additions: 5, deletions: 1, total: 6 },
        files: [],
      }
      mockFetch.mockResolvedValueOnce(mockOkResponse(detail))

      const result = await fetchCommitDetailViaProxy('facebook', 'react', 'abc123')

      expect(result).toEqual(detail)
      const fetchUrl = mockFetch.mock.calls[0][0] as string
      expect(fetchUrl).toContain('/api/github/commit/abc123')
      expect(fetchUrl).toContain('owner=facebook')
      expect(fetchUrl).toContain('name=react')
    })

    it('uses commit-detail cache key', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({}))

      await fetchCommitDetailViaProxy('owner', 'repo', 'sha456')

      expect(cacheMock.getCached).toHaveBeenCalledWith('commit-detail:owner/repo:sha456')
    })
  })

  // -----------------------------------------------------------------------
  // invalidateRepoCache — includes git history patterns
  // -----------------------------------------------------------------------

  describe('invalidateRepoCache includes git history patterns', () => {
    it('invalidates blame, commit-detail, and file-commits patterns', () => {
      invalidateRepoCache('facebook', 'react')

      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('blame:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('commit-detail:facebook/react')
      expect(cacheMock.invalidatePattern).toHaveBeenCalledWith('file-commits:facebook/react')
    })
  })
})
