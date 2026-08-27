import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn()
const mockApplyRateLimit = vi.fn()

vi.mock('@/lib/auth/token', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: (...args: unknown[]) => mockApplyRateLimit(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) =>
    Response.json({ error: { code, message } }, { status }),
}))

vi.mock('@/lib/github/validation', () => ({
  GITHUB_NAME_RE: /^[a-zA-Z0-9._-]+$/,
}))

import { POST } from '@/app/api/github/zipball/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/github/zipball', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/github/zipball', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockResolvedValue('mock-token')
    mockApplyRateLimit.mockReturnValue(null) // no rate limit
  })

  it('uses an explicit low quota for the high-amplification archive proxy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('zip-data', { status: 200 }),
    )

    await POST(createRequest({ owner: 'acme', repo: 'project', ref: 'main' }))

    expect(mockApplyRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      { bucket: '/api/github/zipball', limit: 5, windowMs: 60_000 },
    )
  })

  it('rejects an oversized JSON body before resolving credentials', async () => {
    const res = await POST(createRequest({
      owner: 'acme',
      repo: 'project',
      ref: 'x'.repeat(5_000),
    }))

    expect(res.status).toBe(413)
    expect(mockGetAccessToken).not.toHaveBeenCalled()
  })

  it('returns a streaming response with body as ReadableStream', async () => {
    const fakeBody = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array([80, 75, 3, 4])) // PK zip header
        ctrl.close()
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(fakeBody, {
        status: 200,
        headers: { 'Content-Length': '1234' },
      }),
    )

    const req = createRequest({ owner: 'acme', repo: 'project', ref: 'main' })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.body).toBeInstanceOf(ReadableStream)
  })

  it('sets Content-Type to application/zip', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('zip-data', { status: 200 }),
    )

    const req = createRequest({ owner: 'acme', repo: 'project', ref: 'main' })
    const res = await POST(req)

    expect(res.headers.get('Content-Type')).toBe('application/zip')
  })

  it('forwards Content-Length from GitHub when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('zip-data', {
        status: 200,
        headers: { 'Content-Length': '98765' },
      }),
    )

    const req = createRequest({ owner: 'acme', repo: 'project', ref: 'main' })
    const res = await POST(req)

    expect(res.headers.get('Content-Length')).toBe('98765')
  })

  it('omits Content-Length when GitHub does not provide it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('zip-data', { status: 200 }),
    )

    const req = createRequest({ owner: 'acme', repo: 'project', ref: 'main' })
    const res = await POST(req)

    expect(res.headers.get('Content-Length')).toBeNull()
  })

  it('rejects a zipball whose declared response exceeds the byte ceiling', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('zip-data', {
        status: 200,
        headers: { 'Content-Length': String(50_000_001) },
      }),
    )

    const req = createRequest({ owner: 'acme', repo: 'project', ref: 'main' })
    const res = await POST(req)

    expect(res.status).toBe(413)
  })

  it('errors downstream and cancels an unknown-length upstream after crossing the byte ceiling', async () => {
    const cancelUpstream = vi.fn()
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Leave the body open after this chunk so reader.cancel() reaches the
        // upstream source instead of becoming a no-op on a closed stream.
        controller.enqueue(new Uint8Array(50_000_001))
      },
      cancel: cancelUpstream,
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(upstream, { status: 200 }),
    )

    const response = await POST(createRequest({ owner: 'acme', repo: 'project', ref: 'main' }))

    expect(response.headers.get('Content-Length')).toBeNull()
    await expect(response.arrayBuffer()).rejects.toThrow()
    expect(cancelUpstream).toHaveBeenCalledTimes(1)
  })

  it('streams successfully when the Edge runtime does not provide AbortSignal.any', async () => {
    const originalAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any')
    Object.defineProperty(AbortSignal, 'any', {
      configurable: true,
      value: undefined,
    })

    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('zip-data', { status: 200 }),
      )

      const req = createRequest({ owner: 'acme', repo: 'project', ref: 'main' })
      const res = await POST(req)

      expect(res.status).toBe(200)
      await expect(res.text()).resolves.toBe('zip-data')
    } finally {
      if (originalAny) {
        Object.defineProperty(AbortSignal, 'any', originalAny)
      } else {
        Reflect.deleteProperty(AbortSignal, 'any')
      }
    }
  })
})
