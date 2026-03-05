import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn()
const mockFetchBlame = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/github/fetcher', () => ({
  fetchBlame: (...args: unknown[]) => mockFetchBlame(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) => {
    return Response.json(
      { error: { code, message } },
      { status },
    )
  },
}))

import { POST } from '@/app/api/github/blame/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/github/blame'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/github/blame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue('mock-token')
  })

  it('returns blame data for a valid request', async () => {
    const blameData = {
      ranges: [
        {
          startingLine: 1,
          endingLine: 5,
          age: 2,
          commit: {
            oid: 'abc123',
            abbreviatedOid: 'abc123',
            message: 'init',
            messageHeadline: 'init',
            committedDate: '2025-01-01T00:00:00Z',
            url: 'https://github.com/o/r/commit/abc123',
            author: null,
          },
        },
      ],
      isTruncated: false,
      byteSize: 256,
    }
    mockFetchBlame.mockResolvedValue(blameData)

    const req = createPostRequest({
      owner: 'facebook',
      name: 'react',
      ref: 'main',
      path: 'src/index.ts',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(blameData)
    expect(mockFetchBlame).toHaveBeenCalledWith(
      'facebook', 'react', 'main', 'src/index.ts',
      { token: 'mock-token' },
    )
  })

  it('returns 401 when no token is available', async () => {
    mockGetAccessToken.mockResolvedValue(null)

    const req = createPostRequest({
      owner: 'facebook',
      name: 'react',
      ref: 'main',
      path: 'src/index.ts',
    })
    const res = await POST(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('AUTH_REQUIRED')
  })

  it('returns 400 for missing required fields', async () => {
    const req = createPostRequest({ owner: 'facebook' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for invalid owner name', async () => {
    const req = createPostRequest({
      owner: '../traversal',
      name: 'react',
      ref: 'main',
      path: 'src/index.ts',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 500 when fetcher throws an unexpected error', async () => {
    mockFetchBlame.mockRejectedValue(new Error('Server error'))

    const req = createPostRequest({
      owner: 'facebook',
      name: 'react',
      ref: 'main',
      path: 'src/index.ts',
    })
    const res = await POST(req)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('Failed to fetch blame data')
  })
})
