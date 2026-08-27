import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schema-level tests — replicate the route's validation schema locally
// to test input validation without importing the route directly.
// ---------------------------------------------------------------------------

const NPM_NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

const depsRequestSchema = z.object({
  packages: z
    .array(z.string().regex(NPM_NAME_REGEX).max(214))
    .min(1)
    .max(20),
})

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    packages: ['react'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe('deps API — schema validation', () => {
  it('accepts a valid request with one package', () => {
    const result = depsRequestSchema.safeParse(validRequest())
    expect(result.success).toBe(true)
  })

  it('accepts a request with multiple packages', () => {
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: ['react', 'vue', 'next'] }),
    )
    expect(result.success).toBe(true)
  })

  it('accepts scoped package names', () => {
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: ['@types/react', '@babel/core'] }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects missing packages field', () => {
    const result = depsRequestSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty packages array', () => {
    const result = depsRequestSchema.safeParse(validRequest({ packages: [] }))
    expect(result.success).toBe(false)
  })

  it('rejects packages array exceeding 20 entries', () => {
    const packages = Array.from({ length: 21 }, (_, i) => `pkg-${i}`)
    const result = depsRequestSchema.safeParse(validRequest({ packages }))
    expect(result.success).toBe(false)
  })

  it('accepts exactly 20 packages', () => {
    const packages = Array.from({ length: 20 }, (_, i) => `pkg-${i}`)
    const result = depsRequestSchema.safeParse(validRequest({ packages }))
    expect(result.success).toBe(true)
  })

  it('rejects path traversal attempt "../../../etc/passwd"', () => {
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: ['../../../etc/passwd'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects SSRF-style package names with slashes', () => {
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: ['http://evil.com/pkg'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects package names starting with uppercase', () => {
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: ['React'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects package names with special characters', () => {
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: ['pkg!@#$'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects non-string array elements', () => {
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: [123, true] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects package names exceeding 214 chars', () => {
    const longName = 'a'.repeat(215)
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: [longName] }),
    )
    expect(result.success).toBe(false)
  })

  it('accepts package names at exactly 214 chars', () => {
    const name = 'a'.repeat(214)
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: [name] }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects packages containing spaces', () => {
    const result = depsRequestSchema.safeParse(
      validRequest({ packages: ['my package'] }),
    )
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Route handler integration tests — test the actual POST handler
// ---------------------------------------------------------------------------

describe('deps API — POST handler', () => {
  let POST: (req: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    // Mock global fetch for npm registry calls
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('registry.npmjs.org')) {
        if (url.includes('/latest')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                version: '19.0.0',
                description: 'A JS library for building UIs',
                license: 'MIT',
                maintainers: [{ name: 'fb' }],
                deprecated: false,
              }),
          }
        }
        return new Response(JSON.stringify({
          objects: [{
            package: {
              name: 'react',
              version: '19.0.0',
              date: '2026-03-01T00:00:00Z',
            },
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (typeof url === 'string' && url.includes('api.npmjs.org/downloads')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              downloads: [
                { day: '2026-03-04', downloads: 100000 },
                { day: '2026-03-05', downloads: 120000 },
              ],
            }),
        }
      }

      return { ok: false, status: 404 }
    })

    // Dynamically import route to pick up mocked fetch
    const mod = await import('../route')
    POST = mod.POST
  })

  it('returns 200 with results for valid request', async () => {
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toHaveProperty('results')
    expect(data).toHaveProperty('errors')
    expect(data.results).toHaveProperty('react')
    expect(data.results.react.name).toBe('react')
  })

  it('returns dependency metadata when the Edge runtime does not provide AbortSignal.any', async () => {
    const originalAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any')
    Object.defineProperty(AbortSignal, 'any', {
      configurable: true,
      value: undefined,
    })

    try {
      const req = new Request('http://localhost/api/deps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: ['react'] }),
      })

      const res = await POST(req)
      const data = await res.json()

      expect(data.results.react.name).toBe('react')
    } finally {
      if (originalAny) {
        Object.defineProperty(AbortSignal, 'any', originalAny)
      } else {
        Reflect.deleteProperty(AbortSignal, 'any')
      }
    }
  })

  it('uses the latest version publication time and ignores Last-Modified', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init
      const url = String(input)
      if (url.includes('/latest')) {
        return new Response(JSON.stringify({ version: '19.0.0', maintainers: [] }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return new Response(JSON.stringify({ downloads: [] }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        objects: [{
          package: {
            name: 'react',
            version: '19.0.0',
            date: '2020-03-01T00:00:00Z',
          },
        }],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Last-Modified': 'Sun, 01 Mar 2099 00:00:00 GMT',
        },
      })
    })
    globalThis.fetch = fetchMock
    vi.resetModules()
    POST = (await import('../route')).POST

    const response = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await response.json()

    expect(data.results.react.lastPublish).toBe('2020-03-01T00:00:00.000Z')
    const publishCall = fetchMock.mock.calls.find(([url]) => (
      String(url).includes('registry.npmjs.org') && !String(url).includes('/latest')
    ))
    expect(String(publishCall?.[0])).toContain('/-/v1/search')
    expect(publishCall?.[1]).not.toMatchObject({ method: 'HEAD' })
  })

  it.each([
    ['missing timestamp', { objects: [{ package: { name: 'react', version: '19.0.0' } }] }],
    ['malformed timestamp', { objects: [{ package: { name: 'react', version: '19.0.0', date: 123 } }] }],
    ['stale version', { objects: [{ package: { name: 'react', version: '18.0.0', date: '2020-01-01T00:00:00Z' } }] }],
  ])('keeps publish time unknown for %s registry search metadata', async (_case, searchResult) => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return new Response(JSON.stringify({ version: '19.0.0', maintainers: [] }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return new Response(JSON.stringify({ downloads: [] }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(searchResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const response = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await response.json()

    expect(data.results.react.lastPublish).toBeNull()
  })

  it('returns 422 for empty packages array', async () => {
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: [] }),
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 for missing packages field', async () => {
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'react' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('propagates the caller abort reason while reading the request body', async () => {
    const controller = new AbortController()
    const reason = new DOMException('client disconnected while uploading', 'AbortError')
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel,
    })
    const pending = POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }))

    controller.abort(reason)
    const timeout = new Promise((resolve) => setTimeout(() => resolve(Symbol('timed out')), 100))

    await expect(Promise.race([
      pending.then(() => Symbol('resolved'), (error) => error),
      timeout,
    ])).resolves.toBe(reason)
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects an oversized chunked JSON body before registry work', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch)
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.70',
      },
      body: JSON.stringify({ packages: ['react'], padding: 'x'.repeat(33_000) }),
    })

    const res = await POST(req)

    expect(res.status).toBe(413)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps oversized declared npm metadata as an error and cancels the body', async () => {
    const cancel = vi.fn()
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 200,
          headers: { 'Content-Length': String(256 * 1024 + 1) },
        })
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: true, json: () => Promise.resolve({ downloads: [] }) }
      }
      return new Response(null, {
        status: 200,
        headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' },
      })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/response body|bytes|large/i)
    expect(cancel).toHaveBeenCalled()
  })

  it('keeps oversized chunked npm download data as an error and cancels the body', async () => {
    const cancel = vi.fn()
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return { ok: true, json: () => Promise.resolve({ version: '19.0.0', maintainers: [] }) }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024))
            controller.enqueue(new Uint8Array(1))
          },
          cancel,
        }), { status: 200 })
      }
      return new Response(null, {
        status: 200,
        headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' },
      })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/response body|bytes|large/i)
    expect(cancel).toHaveBeenCalled()
  })

  it('cancels a non-OK npm metadata response before recording the error', async () => {
    const cancel = vi.fn()
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 503,
          statusText: 'Unavailable',
        })
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: true, json: () => Promise.resolve({ downloads: [] }) }
      }
      return new Response(null, {
        status: 200,
        headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' },
      })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/metadata|503|unavailable/i)
    expect(cancel).toHaveBeenCalled()
  })

  it('cancels a non-OK npm download response before recording the error', async () => {
    const cancel = vi.fn()
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return { ok: true, json: () => Promise.resolve({ version: '19.0.0', maintainers: [] }) }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 503,
          statusText: 'Unavailable',
        })
      }
      return new Response(null, {
        status: 200,
        headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' },
      })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/download|metadata|503|unavailable/i)
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects an oversized reflected npm version string', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return { ok: true, json: () => Promise.resolve({ version: '1'.repeat(257), maintainers: [] }) }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: true, json: () => Promise.resolve({ downloads: [] }) }
      }
      return new Response(null, { status: 200, headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' } })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/version|incomplete|length|invalid/i)
  })

  it('rejects a malformed reflected npm download day', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return { ok: true, json: () => Promise.resolve({ version: '19.0.0', maintainers: [] }) }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: true, json: () => Promise.resolve({ downloads: [{ day: 'x'.repeat(33), downloads: 1 }] }) }
      }
      return new Response(null, { status: 200, headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' } })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/day|download|incomplete|invalid/i)
  })

  it('rejects negative or unsafe npm download counts', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return { ok: true, json: () => Promise.resolve({ version: '19.0.0', maintainers: [] }) }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: true, json: () => Promise.resolve({ downloads: [{ day: '2026-03-01', downloads: -1 }] }) }
      }
      return new Response(null, { status: 200, headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' } })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const negative = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const negativeData = await negative.json()
    expect(negativeData.results.react).toBeUndefined()

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return { ok: true, json: () => Promise.resolve({ version: '19.0.0', maintainers: [] }) }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: true, json: () => Promise.resolve({ downloads: [{ day: '2026-03-01', downloads: Number.MAX_SAFE_INTEGER + 1 }] }) }
      }
      return new Response(null, { status: 200, headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' } })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const unsafe = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const unsafeData = await unsafe.json()
    expect(unsafeData.results.react).toBeUndefined()
    expect(unsafeData.errors.join(' ')).toMatch(/download|safe|integer|invalid/i)
  })

  it('rejects an unsafe weekly npm download aggregate', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return { ok: true, json: () => Promise.resolve({ version: '19.0.0', maintainers: [] }) }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return {
          ok: true,
          json: () => Promise.resolve({ downloads: [
            { day: '2026-03-01', downloads: Number.MAX_SAFE_INTEGER },
            { day: '2026-03-02', downloads: Number.MAX_SAFE_INTEGER },
          ] }),
        }
      }
      return new Response(null, { status: 200, headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' } })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/download|safe|aggregate|invalid/i)
  })

  it('rate limits malformed requests before parsing', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.71',
    }
    for (let index = 0; index < 30; index++) {
      const response = await POST(new Request('http://localhost/api/deps', {
        method: 'POST',
        headers,
        body: 'not-json',
      }))
      expect(response.status).toBe(400)
    }

    const blocked = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers,
      body: 'not-json',
    }))
    expect(blocked.status).toBe(429)
  })

  it('returns 422 for path traversal package names', async () => {
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['../../../etc/passwd'] }),
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 for too many packages (>200)', async () => {
    const packages = Array.from({ length: 201 }, (_, i) => `pkg-${i}`)
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages }),
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 when the dependency batch exceeds the amplification ceiling', async () => {
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: Array.from({ length: 21 }, (_, i) => `pkg-${i}`) }),
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('deduplicates package names before fetching registry data', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch)
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react', 'react'] }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('react'))).toHaveLength(3)
  })

  it('allows one 60-package analysis across contract-sized batches', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.60',
    }

    for (let batch = 0; batch < 3; batch++) {
      const packages = Array.from({ length: 20 }, (_, index) => `pkg-${batch * 20 + index}`)
      const response = await POST(new Request('http://localhost/api/deps', {
        method: 'POST',
        headers,
        body: JSON.stringify({ packages }),
      }))
      expect(response.status).toBe(200)
    }

    const blocked = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers,
      body: JSON.stringify({ packages: ['pkg-60'] }),
    }))
    expect(blocked.status).toBe(429)
  })

  it('captures npm registry errors in the errors array', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Registry down'))

    // Re-import to pick up new mock
    vi.resetModules()
    const mod = await import('../route')
    POST = mod.POST

    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.errors.length).toBeGreaterThan(0)
    expect(Object.keys(data.results)).toHaveLength(0)
  })

  it('aborts every npm metadata request when the client disconnects', async () => {
    const observedSignals: AbortSignal[] = []
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => (
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal
        observedSignals.push(signal)
        const rejectAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        if (signal.aborted) rejectAbort()
        else signal.addEventListener('abort', rejectAbort, { once: true })
      })
    ))
    vi.resetModules()
    POST = (await import('../route')).POST
    const controller = new AbortController()
    const response = POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
      signal: controller.signal,
    }))

    await vi.waitFor(() => expect(observedSignals).toHaveLength(3))
    controller.abort(new DOMException('Client disconnected', 'AbortError'))
    await expect(response).rejects.toMatchObject({ name: 'AbortError' })

    expect(observedSignals.every(signal => signal.aborted)).toBe(true)
  })

  it('stops scheduling additional dependency workers after caller cancellation', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Client disconnected', 'AbortError')
    let callCount = 0
    const observedSignals: AbortSignal[] = []
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      callCount++
      const signal = init?.signal as AbortSignal
      observedSignals.push(signal)
      if (callCount === 1) controller.abort(reason)
      return Promise.reject(signal.reason ?? reason)
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const response = POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      body: JSON.stringify({ packages: Array.from({ length: 20 }, (_, index) => `pkg-${index}`) }),
      signal: controller.signal,
    }))

    await expect(response).rejects.toMatchObject({ name: 'AbortError' })
    expect(observedSignals).toHaveLength(3)
  })

  it('does not replace missing publish metadata with the current time', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return {
          ok: true,
          json: () => Promise.resolve({ version: '19.0.0', maintainers: [] }),
        }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: true, json: () => Promise.resolve({ downloads: [] }) }
      }
      return { ok: false, status: 503, statusText: 'Unavailable' }
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/publish|503|unavailable/i)
  })

  it('does not replace unavailable download metadata with zero downloads', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/latest')) {
        return {
          ok: true,
          json: () => Promise.resolve({ version: '19.0.0', maintainers: [] }),
        }
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: false, status: 503, statusText: 'Unavailable' }
      }
      return new Response(null, {
        status: 200,
        headers: { 'Last-Modified': 'Sun, 01 Mar 2026 00:00:00 GMT' },
      })
    })
    vi.resetModules()
    POST = (await import('../route')).POST

    const res = await POST(new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    }))
    const data = await res.json()

    expect(data.results.react).toBeUndefined()
    expect(data.errors.join(' ')).toMatch(/download|503|unavailable/i)
  })

  it('response shape includes results Record and errors array', async () => {
    const req = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(typeof data.results).toBe('object')
    expect(Array.isArray(data.errors)).toBe(true)
  })
})
