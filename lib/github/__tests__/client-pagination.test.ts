import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: () => Promise.resolve(undefined),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: () => null,
  refundRateLimit: () => {},
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  clearGitHubCache,
  fetchBranchesViaProxy,
  fetchCommitsViaProxy,
  fetchFileCommitsViaProxy,
  fetchTagsViaProxy,
  setGitHubPAT,
} from '../client'
import { GITHUB_LIST_MAX_PAGES } from '../pagination'
import { GET as tagsRoute } from '@/app/api/github/tags/route'
import { GET as branchesRoute } from '@/app/api/github/branches/route'

// ---------------------------------------------------------------------------
// Fake GitHub: /tags has 3 pages, /branches never stops advertising a next page
// ---------------------------------------------------------------------------

const TAG_PAGES = [['v9', 'v8'], ['v7', 'v6'], ['v5']]

function githubListResponse(items: unknown[], next?: string): Response {
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: next ? { Link: `<${next}>; rel="next"` } : {},
  })
}

function fakeGitHub(url: URL): Response {
  const page = Number(url.searchParams.get('page') ?? '1')
  if (url.pathname.endsWith('/tags')) {
    const names = TAG_PAGES[page - 1] ?? []
    const next = page < TAG_PAGES.length
      ? `https://api.github.com/repositories/7/tags?per_page=100&page=${page + 1}`
      : undefined
    return githubListResponse(names.map(name => ({
      name,
      commit: { sha: `sha-${name}`, url: `https://api.github.com/repos/X/Y/commits/sha-${name}` },
      tarball_url: `https://api.github.com/repos/X/Y/tarball/${name}`,
      zipball_url: `https://api.github.com/repos/X/Y/zipball/${name}`,
    })), next)
  }
  if (url.pathname.endsWith('/branches')) {
    return githubListResponse(
      [{ name: `branch-${page}`, commit: { sha: `sha-${page}` }, protected: page === 1 }],
      `https://api.github.com/repositories/7/branches?per_page=100&page=${page + 1}`,
    )
  }
  return githubListResponse([])
}

/** Serve proxy routes with the real handlers and GitHub URLs with the fake. */
async function serve(input: RequestInfo | URL): Promise<Response> {
  const raw = String(input)
  if (raw.startsWith('/api/github/tags')) return tagsRoute(new NextRequest(`http://localhost${raw}`))
  if (raw.startsWith('/api/github/branches')) return branchesRoute(new NextRequest(`http://localhost${raw}`))
  if (raw.startsWith('/')) return Response.json([])
  return fakeGitHub(new URL(raw))
}

function githubCalls(): string[] {
  return mockFetch.mock.calls.map(([input]) => String(input)).filter(url => url.startsWith('https://'))
}

function proxyCalls(): URL[] {
  return mockFetch.mock.calls
    .map(([input]) => String(input))
    .filter(url => url.startsWith('/'))
    .map(url => new URL(url, 'http://localhost'))
}

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(serve)
  setGitHubPAT(null)
  clearGitHubCache()
})

afterEach(() => {
  setGitHubPAT(null)
})

describe('tags and branches pagination', () => {
  it('returns the complete tag list in PAT direct mode by following Link pages', async () => {
    setGitHubPAT('ghp_direct')

    const result = await fetchTagsViaProxy('X', 'Y')

    expect(result.truncated).toBe(false)
    expect(result.tags.map(tag => tag.name)).toEqual(['v9', 'v8', 'v7', 'v6', 'v5'])
    expect(githubCalls()).toEqual([
      'https://api.github.com/repos/X/Y/tags?per_page=100',
      'https://api.github.com/repositories/7/tags?per_page=100&page=2',
      'https://api.github.com/repositories/7/tags?per_page=100&page=3',
    ])
    for (const [, init] of mockFetch.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ghp_direct' })
    }
  })

  it('returns identical tag data in proxy mode and PAT direct mode', async () => {
    const viaProxy = await fetchTagsViaProxy('X', 'Y')
    expect(proxyCalls()[0].searchParams.get('per_page')).toBe('100')

    setGitHubPAT('ghp_direct')
    const direct = await fetchTagsViaProxy('X', 'Y')

    expect(viaProxy.tags).toHaveLength(5)
    expect(direct).toEqual(viaProxy)
  })

  it('caps branch pagination identically in both modes and reports truncation', async () => {
    const viaProxy = await fetchBranchesViaProxy('X', 'Y')
    expect(proxyCalls()[0].searchParams.get('per_page')).toBe('100')
    const proxiedGitHubCalls = githubCalls().length

    mockFetch.mockClear()
    setGitHubPAT('ghp_direct')
    const direct = await fetchBranchesViaProxy('X', 'Y')

    expect(proxiedGitHubCalls).toBe(GITHUB_LIST_MAX_PAGES)
    expect(githubCalls()).toHaveLength(GITHUB_LIST_MAX_PAGES)
    expect(viaProxy.truncated).toBe(true)
    expect(viaProxy.branches).toHaveLength(GITHUB_LIST_MAX_PAGES)
    expect(direct).toEqual(viaProxy)
  })
})

describe('commit history paging parameters', () => {
  it('sends page and an explicit per_page through the proxy', async () => {
    await fetchCommitsViaProxy('X', 'Y', { sha: 'main', page: 3 })
    await fetchFileCommitsViaProxy('X', 'Y', 'src/a.ts', { page: 2 })

    const [commits, fileCommits] = proxyCalls()
    expect(commits.searchParams.get('page')).toBe('3')
    expect(commits.searchParams.get('per_page')).toBe('100')
    expect(fileCommits.searchParams.get('page')).toBe('2')
    expect(fileCommits.searchParams.get('per_page')).toBe('100')
  })

  it('sends page and an explicit per_page directly to GitHub in PAT mode', async () => {
    setGitHubPAT('ghp_direct')

    await fetchCommitsViaProxy('X', 'Y', { sha: 'main', perPage: 30, page: 3 })
    await fetchFileCommitsViaProxy('X', 'Y', 'src/a.ts', { page: 2 })

    const [commits, fileCommits] = githubCalls().map(url => new URL(url))
    expect(commits.pathname).toBe('/repos/X/Y/commits')
    expect(commits.searchParams.get('page')).toBe('3')
    expect(commits.searchParams.get('per_page')).toBe('30')
    expect(fileCommits.searchParams.get('page')).toBe('2')
    expect(fileCommits.searchParams.get('per_page')).toBe('100')
    expect(fileCommits.searchParams.get('path')).toBe('src/a.ts')
  })
})
