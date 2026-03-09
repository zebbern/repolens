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
})
