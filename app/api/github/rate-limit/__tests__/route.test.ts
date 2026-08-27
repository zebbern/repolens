import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mockFetch = vi.fn()
const mockGetAccessToken = vi.fn()

vi.stubGlobal('fetch', mockFetch)
vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))
vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: () => null,
}))

import { GET } from '../route'

function mockRequest(signal: AbortSignal): NextRequest {
  return {
    headers: new Headers(),
    signal,
  } as unknown as NextRequest
}

describe('GET /api/github/rate-limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue(undefined)
  })

  it('aborts the upstream request when the incoming request is aborted', async () => {
    const caller = new AbortController()
    let upstreamSignal: AbortSignal | undefined
    let resolveFetch: ((response: Response) => void) | undefined
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined
      return new Promise<Response>(resolve => {
        resolveFetch = resolve
      })
    })

    const pending = GET(mockRequest(caller.signal))
    await Promise.resolve()
    expect(mockGetAccessToken).toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalled()
    const reason = new DOMException('request cancelled', 'AbortError')
    caller.abort(reason)
    expect(upstreamSignal?.aborted).toBe(true)
    expect(upstreamSignal?.reason).toBe(reason)

    resolveFetch?.({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rate: { limit: 60, remaining: 59, reset: 1 } }),
    } as unknown as Response)
    await pending
  })
})
