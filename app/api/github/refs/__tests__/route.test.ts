import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn()
const mockFetchTags = vi.fn()
const mockFetchBranches = vi.fn()
const mockApplyRateLimit = vi.fn()
const mockRefundRateLimit = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/github/fetcher', () => ({
  fetchTags: (...args: unknown[]) => mockFetchTags(...args),
  fetchBranches: (...args: unknown[]) => mockFetchBranches(...args),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: (...args: unknown[]) => mockApplyRateLimit(...args),
  refundRateLimit: (...args: unknown[]) => mockRefundRateLimit(...args),
}))

import { GET } from '@/app/api/github/refs/route'
import { GITHUB_LIST_MAX_PAGES } from '@/lib/github/pagination'
import { NextRequest } from 'next/server'
import { GitHubError } from '@/lib/github/errors'

function createRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/github/refs')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

const TAG = { name: 'v1.0.0', commitSha: 'abc123', commitUrl: '', tarballUrl: '', zipballUrl: '' }
const BRANCH = { name: 'main', commitSha: 'def456', isProtected: true }

describe('GET /api/github/refs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue(undefined)
    mockApplyRateLimit.mockReturnValue(null)
    mockFetchTags.mockResolvedValue({ items: [TAG], truncated: false })
    mockFetchBranches.mockResolvedValue({ items: [BRANCH], truncated: false })
  })

  it('returns complete tag and branch lists with per-list truncation flags', async () => {
    const res = await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      tags: [TAG],
      branches: [BRANCH],
      tagsTruncated: false,
      branchesTruncated: false,
    })
    expect(mockFetchTags).toHaveBeenCalledWith('facebook', 'react', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(mockFetchBranches).toHaveBeenCalledWith('facebook', 'react', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('reports which list hit the page cap', async () => {
    mockFetchTags.mockResolvedValue({ items: [TAG], truncated: true })

    const res = await GET(createRequest({ owner: 'facebook', name: 'react' }))

    await expect(res.json()).resolves.toMatchObject({ tagsTruncated: true, branchesTruncated: false })
  })

  it('admits a request at the worst-case walk of both lists and refunds unused pages', async () => {
    mockFetchTags.mockResolvedValue({ items: Array.from({ length: 1000 }, () => TAG), truncated: true })

    await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(mockApplyRateLimit).toHaveBeenCalledWith(expect.any(Request), {
      bucket: '/api/github/refs',
      cost: 2 * GITHUB_LIST_MAX_PAGES,
    })
    expect(mockRefundRateLimit).toHaveBeenCalledWith(expect.any(Request), {
      bucket: '/api/github/refs',
      cost: GITHUB_LIST_MAX_PAGES - 1,
    })
  })

  it('maps a missing repository to 404', async () => {
    mockFetchTags.mockRejectedValue(new GitHubError('not_found', { resource: 'tags' }))

    const res = await GET(createRequest({ owner: 'facebook', name: 'missing' }))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'REPO_NOT_FOUND' } })
  })
})
