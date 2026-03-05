import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn()
const mockFetchCommitDetail = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/github/fetcher', () => ({
  fetchCommitDetail: (...args: unknown[]) => mockFetchCommitDetail(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) => {
    return Response.json(
      { error: { code, message } },
      { status },
    )
  },
}))

import { GET } from '@/app/api/github/commit/[sha]/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(sha: string, queryParams: Record<string, string>): NextRequest {
  const url = new URL(`http://localhost:3000/api/github/commit/${sha}`)
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

function createParams(sha: string): Promise<{ sha: string }> {
  return Promise.resolve({ sha })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/github/commit/[sha]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue('mock-token')
  })

  it('returns commit detail for a valid request', async () => {
    const commitData = {
      sha: 'abc123def456',
      message: 'feat: add feature',
      authorName: 'Jane',
      authorEmail: 'jane@example.com',
      authorDate: '2025-01-15T10:00:00Z',
      committerName: 'GitHub',
      committerDate: '2025-01-15T10:00:00Z',
      url: 'https://github.com/owner/repo/commit/abc123def456',
      authorLogin: 'janedoe',
      authorAvatarUrl: 'https://avatar.url/jane',
      parents: [],
      stats: { additions: 10, deletions: 2, total: 12 },
      files: [],
    }
    mockFetchCommitDetail.mockResolvedValue(commitData)

    const req = createRequest('abc123def456', { owner: 'facebook', name: 'react' })
    const res = await GET(req, { params: createParams('abc123def456') })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(commitData)
    expect(mockFetchCommitDetail).toHaveBeenCalledWith(
      'facebook', 'react', 'abc123def456',
      { token: 'mock-token' },
    )
  })

  it('returns 400 for invalid SHA format', async () => {
    const req = createRequest('not-a-sha!', { owner: 'facebook', name: 'react' })
    const res = await GET(req, { params: createParams('not-a-sha!') })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toContain('SHA')
  })

  it('returns 400 when owner is missing', async () => {
    const req = createRequest('abc123', { name: 'react' })
    const res = await GET(req, { params: createParams('abc123') })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 404 when commit is not found', async () => {
    mockFetchCommitDetail.mockRejectedValue(new Error('Commit not found: deadbeef'))

    const req = createRequest('deadbeef', { owner: 'facebook', name: 'react' })
    const res = await GET(req, { params: createParams('deadbeef') })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 500 for unexpected errors', async () => {
    mockFetchCommitDetail.mockRejectedValue(new Error('Server error'))

    const req = createRequest('abc123', { owner: 'facebook', name: 'react' })
    const res = await GET(req, { params: createParams('abc123') })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('Failed to fetch commit detail')
  })
})
