import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn()
const mockFetchBranches = vi.fn()
const mockApplyRateLimit = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/github/fetcher', () => ({
  fetchBranches: (...args: unknown[]) => mockFetchBranches(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) => {
    return Response.json(
      { error: { code, message } },
      { status },
    )
  },
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: (...args: unknown[]) => mockApplyRateLimit(...args),
}))

import { GET } from '@/app/api/github/branches/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/github/branches')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/github/branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue(undefined)
    mockApplyRateLimit.mockReturnValue(undefined)
  })

  it('returns public cache headers for an anonymous success response', async () => {
    const mockBranches = [
      { name: 'main', commitSha: 'abc123', isProtected: true },
      { name: 'develop', commitSha: 'def456', isProtected: false },
    ]
    mockFetchBranches.mockResolvedValue(mockBranches)

    const req = createRequest({ owner: 'facebook', name: 'react' })
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
    expect(res.headers.get('CDN-Cache-Control')).toBe('s-maxage=300, stale-while-revalidate=60')
    expect(res.headers.get('Vercel-Cache-Tag')).toBe('github-public')
    expect(res.headers.get('Vary')).toBe('X-GitHub-Token, Cookie')
    const body = await res.json()
    expect(body).toEqual(mockBranches)
  })

  it('returns no-store cache headers for a PAT success response', async () => {
    mockGetAccessToken.mockResolvedValue('ghp_pat_token')
    mockFetchBranches.mockResolvedValue([])

    const res = await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    expect(res.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull()
    expect(res.headers.get('Vary')).toBe('X-GitHub-Token, Cookie')
  })

  it('returns no-store cache headers for an OAuth success response', async () => {
    mockGetAccessToken.mockResolvedValue('gho_oauth_token')
    mockFetchBranches.mockResolvedValue([])

    const res = await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    expect(res.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(res.headers.get('Vary')).toBe('X-GitHub-Token, Cookie')
  })

  it('returns no-store cache headers for a PAT validation error', async () => {
    mockGetAccessToken.mockResolvedValue('ghp_pat_token')

    const res = await GET(createRequest({ name: 'react' }))

    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    expect(res.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(res.headers.get('Vary')).toBe('X-GitHub-Token, Cookie')
  })

  it('returns no-store cache headers for an OAuth rate-limit error', async () => {
    mockGetAccessToken.mockResolvedValue('gho_oauth_token')
    mockApplyRateLimit.mockReturnValue(Response.json({ error: 'Too many requests' }, { status: 429 }))

    const res = await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    expect(res.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(res.headers.get('Vary')).toBe('X-GitHub-Token, Cookie')
  })

  it('handles access-token resolution failure without running the route handler', async () => {
    mockGetAccessToken.mockRejectedValue(new Error('AUTH_SECRET is not configured'))

    const res = await GET(createRequest({ owner: 'facebook', name: 'react' }))

    expect(mockApplyRateLimit).not.toHaveBeenCalled()
    expect(mockFetchBranches).not.toHaveBeenCalled()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      error: {
        code: 'AUTH_RESOLUTION_ERROR',
        message: 'Unable to resolve GitHub authentication',
      },
    })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    expect(res.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(res.headers.get('Vary')).toBe('X-GitHub-Token, Cookie')
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
    mockFetchBranches.mockResolvedValue([])

    const req = createRequest({ owner: 'o', name: 'r', per_page: '30', page: '3' })
    await GET(req)

    expect(mockFetchBranches).toHaveBeenCalledWith('o', 'r', expect.objectContaining({
      perPage: 30,
      page: 3,
    }))
  })

  it('returns 500 when GitHub API throws', async () => {
    mockFetchBranches.mockRejectedValue(new Error('Server error'))

    const req = createRequest({ owner: 'o', name: 'r' })
    const res = await GET(req)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('Server error')
  })

  it('returns 404 when repo not found', async () => {
    mockFetchBranches.mockRejectedValue(new Error('Repository not found'))

    const req = createRequest({ owner: 'o', name: 'missing' })
    const res = await GET(req)

    expect(res.status).toBe(404)
  })

  it('returns 403 on rate limit', async () => {
    mockFetchBranches.mockRejectedValue(new Error('Rate limit exceeded'))

    const req = createRequest({ owner: 'o', name: 'r' })
    const res = await GET(req)

    expect(res.status).toBe(403)
  })
})
