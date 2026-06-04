import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock next/server — provide minimal NextRequest / NextResponse stubs
// ---------------------------------------------------------------------------

class MockHeaders {
  private headers = new Map<string, string>()
  set(key: string, value: string) { this.headers.set(key.toLowerCase(), value) }
  get(key: string) { return this.headers.get(key.toLowerCase()) ?? null }
  has(key: string) { return this.headers.has(key.toLowerCase()) }
}

function createMockNextResponse(type: 'next' | 'rewrite', url?: URL) {
  return {
    type,
    url: url?.toString(),
    headers: new MockHeaders(),
  }
}

vi.mock('next/server', () => {
  class NextRequest {
    nextUrl: URL
    url: string

    constructor(url: string | URL) {
      this.url = typeof url === 'string' ? url : url.toString()
      this.nextUrl = new URL(this.url)
    }
  }

  const NextResponse = {
    next: vi.fn(() => createMockNextResponse('next')),
    rewrite: vi.fn((url: URL) => createMockNextResponse('rewrite', url)),
  }

  return { NextRequest, NextResponse }
})

// Import after mock is set up
import { proxy } from '../../proxy'
import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(path: string, base = 'https://repolens.dev'): InstanceType<typeof NextRequest> {
  return new NextRequest(`${base}${path}`)
}

type MockResponse = ReturnType<typeof createMockNextResponse>

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // Path-based repo rewrite
  // -----------------------------------------------------------------------

  describe('path-based rewrite (/:owner/:repo)', () => {
    it('rewrites GET /owner/repo to /?repo=https://github.com/owner/repo', () => {
      const req = createRequest('/zebbern/repolens')
      const res = proxy(req) as unknown as MockResponse

      expect(NextResponse.rewrite).toHaveBeenCalledOnce()
      const rewriteUrl = (NextResponse.rewrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL
      expect(rewriteUrl.pathname).toBe('/')
      expect(rewriteUrl.searchParams.get('repo')).toBe('https://github.com/zebbern/repolens')
    })

    it('preserves additional query params (e.g. ?view=docs)', () => {
      const req = createRequest('/owner/repo?view=docs')
      proxy(req)

      const rewriteUrl = (NextResponse.rewrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL
      expect(rewriteUrl.searchParams.get('repo')).toBe('https://github.com/owner/repo')
      expect(rewriteUrl.searchParams.get('view')).toBe('docs')
    })

    it('handles trailing slash: /owner/repo/ rewrites correctly', () => {
      const req = createRequest('/owner/repo/')
      proxy(req)

      expect(NextResponse.rewrite).toHaveBeenCalledOnce()
      const rewriteUrl = (NextResponse.rewrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL
      expect(rewriteUrl.searchParams.get('repo')).toBe('https://github.com/owner/repo')
    })

    it('rewrites /owner/repo/tree/<branch> (branch deep link)', () => {
      const req = createRequest('/greensock/gsap-skills/tree/main')
      proxy(req)

      expect(NextResponse.rewrite).toHaveBeenCalledOnce()
      const rewriteUrl = (NextResponse.rewrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL
      expect(rewriteUrl.pathname).toBe('/')
      expect(rewriteUrl.searchParams.get('repo')).toBe('https://github.com/greensock/gsap-skills/tree/main')
    })

    it('rewrites /owner/repo/tree/<branch>/<subpath> (subdirectory deep link)', () => {
      const req = createRequest('/greensock/gsap-skills/tree/main/skills/gsap-react')
      proxy(req)

      const rewriteUrl = (NextResponse.rewrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL
      expect(rewriteUrl.searchParams.get('repo')).toBe(
        'https://github.com/greensock/gsap-skills/tree/main/skills/gsap-react',
      )
    })

    it('rewrites /owner/repo/blob/<branch>/<path> (file deep link)', () => {
      const req = createRequest('/owner/repo/blob/main/src/index.ts')
      proxy(req)

      const rewriteUrl = (NextResponse.rewrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL
      expect(rewriteUrl.searchParams.get('repo')).toBe('https://github.com/owner/repo/blob/main/src/index.ts')
    })

    it('preserves query params on a tree deep link (e.g. ?view=docs)', () => {
      const req = createRequest('/owner/repo/tree/main?view=docs')
      proxy(req)

      const rewriteUrl = (NextResponse.rewrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL
      expect(rewriteUrl.searchParams.get('repo')).toBe('https://github.com/owner/repo/tree/main')
      expect(rewriteUrl.searchParams.get('view')).toBe('docs')
    })
  })

  // -----------------------------------------------------------------------
  // Reserved paths — should NOT be rewritten
  // -----------------------------------------------------------------------

  describe('reserved paths (pass-through)', () => {
    it('does not rewrite /api/github/repo', () => {
      const req = createRequest('/api/github/repo')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })

    it('does not rewrite /_next/static/chunk.js', () => {
      const req = createRequest('/_next/static/chunk.js')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })

    it('does not rewrite /compare (1 segment, reserved)', () => {
      const req = createRequest('/compare')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })

    it('does not rewrite /favicon.ico (1 segment, reserved)', () => {
      const req = createRequest('/favicon.ico')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })

    it('does not rewrite / (root, 0 segments)', () => {
      const req = createRequest('/')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })

    it('does not rewrite /single-segment (only 1 segment)', () => {
      const req = createRequest('/single-segment')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })

    it('does not rewrite /a/b/c (3 segments, not owner/repo)', () => {
      const req = createRequest('/a/b/c')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })

    it('does not rewrite /a/b/c/d (4 segments)', () => {
      const req = createRequest('/a/b/c/d')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })

    it('does not rewrite /owner/repo/issues (3rd segment is not tree/blob)', () => {
      const req = createRequest('/owner/repo/issues')
      proxy(req)

      expect(NextResponse.rewrite).not.toHaveBeenCalled()
      expect(NextResponse.next).toHaveBeenCalledOnce()
    })
  })

  // -----------------------------------------------------------------------
  // Security headers
  // -----------------------------------------------------------------------

  describe('security headers', () => {
    it('adds security headers on rewritten responses', () => {
      const req = createRequest('/owner/repo')
      const res = proxy(req) as unknown as MockResponse

      expect(res.headers.get('X-Frame-Options')).toBe('DENY')
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
      expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block')
    })

    it('adds security headers on pass-through responses', () => {
      const req = createRequest('/')
      const res = proxy(req) as unknown as MockResponse

      expect(res.headers.get('X-Frame-Options')).toBe('DENY')
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
      expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block')
    })
  })
})
