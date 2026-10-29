import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — set up before importing the route
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn()
const mockFetchTags = vi.fn()
const mockApplyRateLimit = vi.fn()
const mockRefundRateLimit = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: (...args: unknown[]) => mockApplyRateLimit(...args),
  refundRateLimit: (...args: unknown[]) => mockRefundRateLimit(...args),
}))

vi.mock('@/lib/github/fetcher', () => ({
  fetchTags: (...args: unknown[]) => mockFetchTags(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) => {
    return Response.json(
      { error: { code, message } },
      { status },
    )
  },
}))

import { GET } from '@/app/api/github/tags/route'
import { GITHUB_LIST_MAX_PAGES } from '@/lib/github/pagination'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/github/tags')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/github/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue('mock-token')
    mockApplyRateLimit.mockReturnValue(null)
  })

  it('returns tags for a valid request', async () => {
    const mockTags = [
      { name: 'v1.0.0', commitSha: 'abc123', commitUrl: '', tarballUrl: '', zipballUrl: '' },
      { name: 'v2.0.0', commitSha: 'def456', commitUrl: '', tarballUrl: '', zipballUrl: '' },
    ]
    mockFetchTags.mockResolvedValue({ items: mockTags, truncated: false })

    const req = createRequest({ owner: 'facebook', name: 'react' })
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ tags: mockTags, truncated: false })
    expect(mockFetchTags).toHaveBeenCalledWith('facebook', 'react', expect.objectContaining({
      token: 'mock-token',
    }))
  })

  it('reports when the tag list hit the page cap', async () => {
    const mockTags = [{ name: 'v1.0.0', commitSha: 'abc123', commitUrl: '', tarballUrl: '', zipballUrl: '' }]
    mockFetchTags.mockResolvedValue({ items: mockTags, truncated: true })

    const res = await GET(createRequest({ owner: 'facebook', name: 'react' }))

    await expect(res.json()).resolves.toEqual({ tags: mockTags, truncated: true })
  })

  it('admits a request at the worst-case page walk', async () => {
    mockFetchTags.mockResolvedValue({ items: [], truncated: false })

    await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(mockApplyRateLimit).toHaveBeenCalledWith(expect.any(Request), {
      bucket: '/api/github/tags',
      cost: GITHUB_LIST_MAX_PAGES,
    })
  })

  it('refunds the pages a single-page walk did not use', async () => {
    mockFetchTags.mockResolvedValue({ items: Array.from({ length: 40 }, (_, i) => ({ name: `x${i}` })), truncated: false })

    await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(mockRefundRateLimit).toHaveBeenCalledWith(expect.any(Request), {
      bucket: '/api/github/tags',
      cost: GITHUB_LIST_MAX_PAGES - 1,
    })
  })

  it('refunds only the pages a walk of the requested size did not use', async () => {
    mockFetchTags.mockResolvedValue({ items: Array.from({ length: 45 }, (_, i) => ({ name: `x${i}` })), truncated: false })

    await GET(createRequest({ owner: 'facebook', name: 'react', per_page: '20' }))

    expect(mockRefundRateLimit).toHaveBeenCalledWith(expect.any(Request), {
      bucket: '/api/github/tags',
      cost: GITHUB_LIST_MAX_PAGES - 3,
    })
  })

  it('refunds nothing when the walk hit the page cap', async () => {
    mockFetchTags.mockResolvedValue({ items: Array.from({ length: 1000 }, (_, i) => ({ name: `x${i}` })), truncated: true })

    await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(mockRefundRateLimit).not.toHaveBeenCalled()
  })

  it('refunds nothing when the walk fails', async () => {
    mockFetchTags.mockRejectedValue(new Error('upstream exploded'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(mockRefundRateLimit).not.toHaveBeenCalled()
  })

  it('returns 400 when owner is missing', async () => {
    const req = createRequest({ name: 'react' })
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when name is missing', async () => {
    const req = createRequest({ owner: 'facebook' })
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('passes per_page and page when provided', async () => {
    mockFetchTags.mockResolvedValue({ items: [], truncated: false })

    const req = createRequest({ owner: 'owner', name: 'repo', per_page: '50', page: '2' })
    await GET(req)

    expect(mockFetchTags).toHaveBeenCalledWith('owner', 'repo', expect.objectContaining({
      perPage: 50,
      page: 2,
    }))
  })

  it('returns a generic 500 without the raw exception text when GitHub API throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchTags.mockRejectedValue(new Error('GitHub API is down'))

    const req = createRequest({ owner: 'owner', name: 'repo' })
    const res = await GET(req)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('Failed to fetch tags')
    expect(JSON.stringify(body)).not.toContain('GitHub API is down')
    expect(consoleError).toHaveBeenCalledWith('[tags] GitHub API error:', 'GitHub API is down')
    consoleError.mockRestore()
  })

  it('returns 404 when repo not found', async () => {
    mockFetchTags.mockRejectedValue(new Error('Repository not found'))

    const req = createRequest({ owner: 'owner', name: 'missing' })
    const res = await GET(req)

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('REPO_NOT_FOUND')
  })

  it('returns 403 on rate limit', async () => {
    mockFetchTags.mockRejectedValue(new Error('Rate limit exceeded'))

    const req = createRequest({ owner: 'owner', name: 'repo' })
    const res = await GET(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('RATE_LIMIT')
  })
})
