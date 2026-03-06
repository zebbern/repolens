import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch (used by the route to call GitHub API)
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from '../route'
import type { NextRequest } from 'next/server'

/** Build a mock NextRequest with an optional X-GitHub-Token header. */
function mockRequest(token?: string): NextRequest {
  const headers = new Headers()
  if (token) headers.set('X-GitHub-Token', token)

  return {
    headers,
  } as unknown as NextRequest
}

function githubOkResponse(login: string, scopes: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ login }),
    headers: new Headers({ 'X-OAuth-Scopes': scopes }),
  } as unknown as Response
}

function githubErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ message: 'Bad credentials' }),
    headers: new Headers(),
  } as unknown as Response
}

describe('POST /api/github/validate-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when X-GitHub-Token header is missing', async () => {
    const response = await POST(mockRequest())
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ valid: false, error: 'Missing X-GitHub-Token header' })
  })

  it('returns valid=true with login and scopes for a valid token', async () => {
    mockFetch.mockResolvedValueOnce(githubOkResponse('octocat', 'repo, read:org'))

    const response = await POST(mockRequest('ghp_valid'))
    const data = await response.json()

    expect(data).toEqual({
      valid: true,
      login: 'octocat',
      scopes: ['repo', 'read:org'],
    })

    // Verify it called GitHub API correctly
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_valid',
        }),
      }),
    )
  })

  it('returns valid=false for an invalid token (401)', async () => {
    mockFetch.mockResolvedValueOnce(githubErrorResponse(401))

    const response = await POST(mockRequest('ghp_invalid'))
    const data = await response.json()

    expect(data).toEqual({
      valid: false,
      error: 'Invalid token',
    })
  })

  it('returns valid=false with status message for non-401 errors', async () => {
    mockFetch.mockResolvedValueOnce(githubErrorResponse(403))

    const response = await POST(mockRequest('ghp_ratelimited'))
    const data = await response.json()

    expect(data).toEqual({
      valid: false,
      error: 'GitHub API returned 403',
    })
  })

  it('returns 500 when fetch throws a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const response = await POST(mockRequest('ghp_network_fail'))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Network error')
  })

  it('handles empty scopes header gracefully', async () => {
    mockFetch.mockResolvedValueOnce(githubOkResponse('octocat', ''))

    const response = await POST(mockRequest('ghp_no_scopes'))
    const data = await response.json()

    expect(data.valid).toBe(true)
    expect(data.scopes).toEqual([])
  })
})
