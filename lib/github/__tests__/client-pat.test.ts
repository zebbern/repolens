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
  _testInternals,
} from '../client'
import { isGitHubError } from '../errors'

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

  describe('direct mode without AbortSignal.any (Safari < 17.4, Chrome < 116, Firefox < 124)', () => {
    const repoData = {
      owner: { login: 'test' }, name: 'repo', full_name: 'test/repo',
      description: null, default_branch: 'main', stargazers_count: 0,
      forks_count: 0, language: null, topics: [], private: false,
      html_url: '', size: 0, open_issues_count: 0, pushed_at: '', license: null,
    }

    function withoutAbortSignalAny<T>(run: () => Promise<T>): Promise<T> {
      const original = AbortSignal.any
      // @ts-expect-error simulating a browser that lacks AbortSignal.any
      delete AbortSignal.any
      return run().finally(() => { AbortSignal.any = original })
    }

    it('loads a repository when the caller passes a signal', async () => {
      setGitHubPAT('ghp_test_token')
      mockFetch.mockResolvedValueOnce(mockOkResponse(repoData))

      const repo = await withoutAbortSignalAny(() => (
        fetchRepoViaProxy('test', 'repo', { signal: new AbortController().signal })
      ))

      expect(repo.fullName).toBe('test/repo')
    })

    it('still aborts the request when the caller aborts', async () => {
      setGitHubPAT('ghp_test_token')
      const controller = new AbortController()
      let requestSignal: AbortSignal | undefined
      mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
        requestSignal = init.signal ?? undefined
        return new Promise(() => {})
      })

      await withoutAbortSignalAny(async () => {
        void fetchRepoViaProxy('test', 'repo', { signal: controller.signal }).catch(() => {})
        await Promise.resolve()
        controller.abort(new DOMException('navigated away', 'AbortError'))
      })

      expect(requestSignal?.aborted).toBe(true)
    })
  })

  describe('direct mode follows GitHub redirects only within api.github.com', () => {
    const repoData = {
      owner: { login: 'new-owner' }, name: 'new-name', full_name: 'new-owner/new-name',
      description: null, default_branch: 'main', stargazers_count: 0,
      forks_count: 0, language: null, topics: [], private: false,
      html_url: '', size: 0, open_issues_count: 0, pushed_at: '', license: null,
    }
    const blameData = {
      data: { repository: { object: { byteSize: 0, isTruncated: false, blame: { ranges: [] } } } },
    }

    /**
     * fetch after following a redirect the way a browser does: redirect:'error'
     * rejects with a network error; otherwise the final response is returned
     * with redirected=true and its own URL.
     */
    function followRedirectTo(finalUrl: string, body: unknown) {
      const json = vi.fn(() => Promise.resolve(body))
      const text = vi.fn(() => Promise.resolve(JSON.stringify(body)))
      const impl = (_input: string, init: RequestInit = {}) => {
        if (init.redirect === 'error') return Promise.reject(new TypeError('Failed to fetch'))
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          redirected: true,
          url: finalUrl,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          body: null,
          json,
          text,
        } as unknown as Response)
      }
      return { impl, json, text }
    }

    it('loads a renamed repository from its new api.github.com location', async () => {
      setGitHubPAT('ghp_test_token')
      mockFetch.mockImplementationOnce(followRedirectTo('https://api.github.com/repositories/42', repoData).impl)

      const repo = await fetchRepoViaProxy('old-owner', 'old-name')

      expect(repo.fullName).toBe('new-owner/new-name')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/old-owner/old-name', expect.any(Object))
    })

    it('loads blame after a redirect within api.github.com', async () => {
      setGitHubPAT('ghp_test_token')
      mockFetch.mockImplementationOnce(followRedirectTo('https://api.github.com/graphql', blameData).impl)

      const blame = await fetchBlameViaProxy('owner', 'repo', 'main', 'src/index.ts')

      expect(blame).toEqual({ ranges: [], isTruncated: false, byteSize: 0 })
    })

    it.each([
      'https://evil.example.com/repositories/42',
      'http://api.github.com/repositories/42',
      'https://api.github.com.evil.example/repositories/42',
      'https://uploads.github.com/repositories/42',
    ])('fails as upstream without reading the body when a REST redirect ends at %s', async (finalUrl) => {
      setGitHubPAT('ghp_test_token')
      const fake = followRedirectTo(finalUrl, repoData)
      mockFetch.mockImplementationOnce(fake.impl)

      const error = await fetchRepoViaProxy('old-owner', 'old-name').catch((e: unknown) => e)

      expect(isGitHubError(error)).toBe(true)
      expect(error).toMatchObject({ kind: 'upstream', message: 'Failed to fetch repository' })
      expect(fake.json).not.toHaveBeenCalled()
      expect(fake.text).not.toHaveBeenCalled()
    })

    it('fails as upstream without reading the body when a GraphQL redirect leaves api.github.com', async () => {
      setGitHubPAT('ghp_test_token')
      const fake = followRedirectTo('https://evil.example.com/graphql', blameData)
      mockFetch.mockImplementationOnce(fake.impl)

      const error = await fetchBlameViaProxy('owner', 'repo', 'main', 'src/index.ts').catch((e: unknown) => e)

      expect(isGitHubError(error)).toBe(true)
      expect(error).toMatchObject({ kind: 'upstream', message: 'Failed to fetch blame data' })
      expect(fake.json).not.toHaveBeenCalled()
      expect(fake.text).not.toHaveBeenCalled()
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

  describe('proxyFetch URL guard', () => {
    it('rejects protocol-relative URLs (//evil.com)', async () => {
      await expect(_testInternals.proxyFetch('//evil.com/attack')).rejects.toThrow(
        'proxyFetch only accepts relative URLs',
      )
    })

    it('rejects absolute URLs', async () => {
      await expect(_testInternals.proxyFetch('https://evil.com')).rejects.toThrow(
        'proxyFetch only accepts relative URLs',
      )
    })
  })
})
