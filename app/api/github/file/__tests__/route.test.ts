import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApplyRateLimit = vi.fn()
const mockFetchFileContent = vi.fn()
const mockGetAccessToken = vi.fn()

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: (...args: unknown[]) => mockApplyRateLimit(...args),
}))

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) =>
    Response.json({ error: { code, message } }, { status }),
}))

// Keep the real error class at the route/fetcher boundary. Mock only the
// fetch operation so this verifies the route's instanceof mapping.
vi.mock('@/lib/github/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/github/fetcher')>()
  return {
    ...actual,
    fetchFileContent: (...args: unknown[]) => mockFetchFileContent(...args),
  }
})

import { GET } from '@/app/api/github/file/route'
import { GitHubResponseTooLargeError } from '@/lib/github/fetcher'
import { NextRequest } from 'next/server'

function createRequest(): NextRequest {
  return new NextRequest(
    'http://localhost/api/github/file?owner=acme&name=project&branch=main&path=src%2Findex.ts',
  )
}

describe('GET /api/github/file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyRateLimit.mockReturnValue(null)
    mockGetAccessToken.mockResolvedValue('mock-token')
  })

  it('maps an oversized GitHub response to HTTP 413 at the route boundary', async () => {
    mockFetchFileContent.mockRejectedValue(new GitHubResponseTooLargeError(2_000_000))

    const response = await GET(createRequest())

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'RESPONSE_TOO_LARGE',
        message: 'File exceeds the maximum response size',
      },
    })
    expect(mockFetchFileContent).toHaveBeenCalledWith(
      'acme',
      'project',
      'main',
      'src/index.ts',
      expect.objectContaining({
        token: 'mock-token',
        signal: expect.any(AbortSignal),
      }),
    )
  })
})
