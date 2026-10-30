import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn()
const mockFetchCommits = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/github/fetcher', () => ({
  fetchCommits: (...args: unknown[]) => mockFetchCommits(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) => {
    return Response.json(
      { error: { code, message } },
      { status },
    )
  },
}))

import { GET } from '@/app/api/github/commits/route'
import { NextRequest } from 'next/server'
import { GitHubError } from '@/lib/github/errors'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/github/commits')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/github/commits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue('mock-token')
  })

  it('returns commits for a valid request', async () => {
    const mockCommits = [
      {
        sha: 'abc123',
        message: 'feat: add feature',
        authorName: 'John',
        authorEmail: 'j@x.com',
        authorDate: '2025-01-01T00:00:00Z',
        committerName: 'John',
        committerDate: '2025-01-01T00:00:00Z',
        url: 'https://api.github.com/commits/abc123',
        authorLogin: 'john',
        authorAvatarUrl: null,
        parents: [],
      },
    ]
    mockFetchCommits.mockResolvedValue(mockCommits)

    const req = createRequest({ owner: 'facebook', name: 'react' })
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(mockCommits)
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

  it('passes sha, since, until params when provided', async () => {
    mockFetchCommits.mockResolvedValue([])

    const req = createRequest({
      owner: 'o',
      name: 'r',
      sha: 'main',
      since: '2025-01-01T00:00:00Z',
      until: '2025-06-01T00:00:00Z',
    })
    await GET(req)

    expect(mockFetchCommits).toHaveBeenCalledWith('o', 'r', expect.objectContaining({
      sha: 'main',
      since: '2025-01-01T00:00:00Z',
      until: '2025-06-01T00:00:00Z',
    }))
  })

  it('passes per_page and page when provided', async () => {
    mockFetchCommits.mockResolvedValue([])

    const req = createRequest({ owner: 'o', name: 'r', per_page: '25', page: '2' })
    await GET(req)

    expect(mockFetchCommits).toHaveBeenCalledWith('o', 'r', expect.objectContaining({
      perPage: 25,
      page: 2,
    }))
  })

  it('returns a generic 500 without the raw exception text when GitHub API throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchCommits.mockRejectedValue(new Error('Server error'))

    const req = createRequest({ owner: 'o', name: 'r' })
    const res = await GET(req)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('Failed to fetch commits')
    expect(JSON.stringify(body)).not.toContain('Server error')
    expect(consoleError).toHaveBeenCalledWith('[commits] GitHub API error:', 'Server error')
    consoleError.mockRestore()
  })

  it('returns 404 when repo not found', async () => {
    mockFetchCommits.mockRejectedValue(new GitHubError('not_found', { resource: 'commits' }))

    const req = createRequest({ owner: 'o', name: 'missing' })
    const res = await GET(req)

    expect(res.status).toBe(404)
  })

  it('returns 403 on rate limit', async () => {
    mockFetchCommits.mockRejectedValue(new GitHubError('rate_limited', { resource: 'commits' }))

    const req = createRequest({ owner: 'o', name: 'r' })
    const res = await GET(req)

    expect(res.status).toBe(403)
  })
})
