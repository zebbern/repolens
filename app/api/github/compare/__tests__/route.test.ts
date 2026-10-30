import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn()
const mockFetchCompare = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/github/fetcher', () => ({
  fetchCompare: (...args: unknown[]) => mockFetchCompare(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) => {
    return Response.json(
      { error: { code, message } },
      { status },
    )
  },
}))

import { GET } from '@/app/api/github/compare/route'
import { NextRequest } from 'next/server'
import { GitHubError } from '@/lib/github/errors'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/github/compare')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/github/compare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue('mock-token')
  })

  it('returns comparison for a valid request', async () => {
    const mockComparison = {
      status: 'ahead',
      aheadBy: 5,
      behindBy: 0,
      totalCommits: 5,
      commits: [],
      files: [],
    }
    mockFetchCompare.mockResolvedValue(mockComparison)

    const req = createRequest({ owner: 'facebook', name: 'react', base: 'v1.0', head: 'v2.0' })
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(mockComparison)
    expect(mockFetchCompare).toHaveBeenCalledWith('facebook', 'react', 'v1.0', 'v2.0', expect.objectContaining({
      token: 'mock-token',
    }))
  })

  it('returns 400 when base is missing', async () => {
    const req = createRequest({ owner: 'o', name: 'r', head: 'v2.0' })
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when head is missing', async () => {
    const req = createRequest({ owner: 'o', name: 'r', base: 'v1.0' })
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when owner and name are missing', async () => {
    const req = createRequest({ base: 'v1.0', head: 'v2.0' })
    const res = await GET(req)

    expect(res.status).toBe(400)
  })

  it('returns a generic 500 without the raw exception text when GitHub API throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchCompare.mockRejectedValue(new Error('Internal error'))

    const req = createRequest({ owner: 'o', name: 'r', base: 'v1', head: 'v2' })
    const res = await GET(req)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('Failed to fetch comparison')
    expect(JSON.stringify(body)).not.toContain('Internal error')
    expect(consoleError).toHaveBeenCalledWith('[compare] GitHub API error:', 'Internal error')
    consoleError.mockRestore()
  })

  it('returns 404 when repo not found', async () => {
    mockFetchCompare.mockRejectedValue(new GitHubError('not_found', { resource: 'comparison' }))

    const req = createRequest({ owner: 'o', name: 'missing', base: 'v1', head: 'v2' })
    const res = await GET(req)

    expect(res.status).toBe(404)
  })

  it('returns 422 for invalid request errors', async () => {
    mockFetchCompare.mockRejectedValue(new GitHubError('invalid', { resource: 'comparison', upstreamMessage: 'No common ancestor' }))

    const req = createRequest({ owner: 'o', name: 'r', base: 'v1', head: 'v1' })
    const res = await GET(req)

    expect(res.status).toBe(422)
  })

  it('returns 403 on rate limit', async () => {
    mockFetchCompare.mockRejectedValue(new GitHubError('rate_limited', { resource: 'comparison' }))

    const req = createRequest({ owner: 'o', name: 'r', base: 'v1', head: 'v2' })
    const res = await GET(req)

    expect(res.status).toBe(403)
  })
})
