import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { fetchBranches, fetchTags } from '../fetcher'
import { GITHUB_LIST_MAX_PAGES } from '../pagination'

const TAGS_PAGE_URL = 'https://api.github.com/repositories/1/tags'
const BRANCHES_PAGE_URL = 'https://api.github.com/repositories/1/branches'

function rawTag(name: string) {
  return {
    name,
    commit: { sha: `sha-${name}`, url: `https://api.github.com/commits/${name}` },
    tarball_url: `https://api.github.com/tarball/${name}`,
    zipball_url: `https://api.github.com/zipball/${name}`,
  }
}

function rawBranch(name: string) {
  return { name, commit: { sha: `sha-${name}` }, protected: false }
}

function listPage(items: unknown[], nextUrl?: string): Response {
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: nextUrl ? { Link: `<${nextUrl}>; rel="next", <${nextUrl}>; rel="last"` } : {},
  })
}

function requestedUrl(call: number): string {
  return String(mockFetch.mock.calls[call][0])
}

describe('fetchTags / fetchBranches Link pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('follows rel="next" across pages starting with per_page=100 and keeps auth on every page', async () => {
    mockFetch
      .mockResolvedValueOnce(listPage([rawTag('v3'), rawTag('v2')], `${TAGS_PAGE_URL}?per_page=100&page=2`))
      .mockResolvedValueOnce(listPage([rawTag('v1')]))

    const result = await fetchTags('owner', 'repo', { token: 'tok' })

    expect(result).toEqual({
      items: ['v3', 'v2', 'v1'].map(name => ({
        name,
        commitSha: `sha-${name}`,
        commitUrl: `https://api.github.com/commits/${name}`,
        tarballUrl: `https://api.github.com/tarball/${name}`,
        zipballUrl: `https://api.github.com/zipball/${name}`,
      })),
      truncated: false,
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(requestedUrl(0)).toBe('https://api.github.com/repos/owner/repo/tags?per_page=100&page=1')
    expect(requestedUrl(1)).toBe(`${TAGS_PAGE_URL}?per_page=100&page=2`)
    for (const [, init] of mockFetch.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' })
    }
  })

  it('stops at the page cap and reports a truncated branch list', async () => {
    mockFetch.mockImplementation(async () => listPage([rawBranch('b')], `${BRANCHES_PAGE_URL}?per_page=100&page=99`))

    const result = await fetchBranches('owner', 'repo')

    expect(mockFetch).toHaveBeenCalledTimes(GITHUB_LIST_MAX_PAGES)
    expect(result.truncated).toBe(true)
    expect(result.items).toHaveLength(GITHUB_LIST_MAX_PAGES)
    expect(requestedUrl(0)).toBe('https://api.github.com/repos/owner/repo/branches?per_page=100&page=1')
  })

  it('reports a complete branch list when GitHub sends no Link header', async () => {
    mockFetch.mockResolvedValueOnce(listPage([rawBranch('main')]))

    await expect(fetchBranches('owner', 'repo')).resolves.toEqual({
      items: [{ name: 'main', commitSha: 'sha-main', isProtected: false }],
      truncated: false,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('stops walking pages once the caller aborts', async () => {
    const caller = new AbortController()
    mockFetch
      .mockImplementationOnce(async () => {
        caller.abort(new DOMException('client went away', 'AbortError'))
        return listPage([rawTag('v2')], `${TAGS_PAGE_URL}?per_page=100&page=2`)
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        if (init.signal?.aborted) throw init.signal.reason
        return listPage([rawTag('v1')])
      })

    await expect(fetchTags('owner', 'repo', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('maps a GitHub error on a later page through the shared error handler', async () => {
    mockFetch
      .mockResolvedValueOnce(listPage([rawTag('v2')], `${TAGS_PAGE_URL}?per_page=100&page=2`))
      .mockResolvedValueOnce(new Response(null, { status: 403, statusText: 'Forbidden' }))

    await expect(fetchTags('owner', 'repo')).rejects.toThrow('Rate limit exceeded')
  })
})
