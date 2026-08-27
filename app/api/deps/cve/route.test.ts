import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryOSV } = vi.hoisted(() => ({
  mockQueryOSV: vi.fn(),
}))

vi.mock('@/lib/code/scanner/cve-lookup', () => ({
  queryOSV: mockQueryOSV,
}))

import { POST } from './route'
import { _resetStore } from '@/lib/api/rate-limit'

type PackageTuple = {
  name: string
  version: string
  type: 'production' | 'dev'
}

function makePackage(index: number): PackageTuple {
  return {
    name: `package-${index}`,
    version: `${index + 1}.0.0`,
    type: 'production',
  }
}

function makeRequest(
  packages: PackageTuple[],
  options: { ip?: string; signal?: AbortSignal } = {},
): Request {
  return new Request('http://localhost/api/deps/cve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': options.ip ?? '203.0.113.10',
    },
    body: JSON.stringify({ packages }),
    signal: options.signal,
  })
}

describe('POST /api/deps/cve', () => {
  beforeEach(() => {
    _resetStore()
    mockQueryOSV.mockReset()
    mockQueryOSV.mockResolvedValue({ results: [], errors: [] })
  })

  it('rejects a batch of 21 package tuples before querying OSV', async () => {
    const response = await POST(makeRequest(Array.from({ length: 21 }, (_, index) => makePackage(index))))

    expect(response.status).toBe(400)
    expect(mockQueryOSV).not.toHaveBeenCalled()
  })

  it('queries each distinct name, version, and dependency-type tuple once', async () => {
    const production = makePackage(0)
    const development = { ...production, type: 'dev' as const }

    const response = await POST(makeRequest([production, production, development]))

    expect(response.status).toBe(200)
    expect(mockQueryOSV).toHaveBeenCalledOnce()
    expect(mockQueryOSV.mock.calls[0]?.[0]).toEqual([production, development])
  })

  it('does not charge malformed requests against the upstream-query budget', async () => {
    const ip = '203.0.113.11'
    for (let index = 0; index < 5; index++) {
      const invalidRequest = new Request('http://localhost/api/deps/cve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ packages: [] }),
      })
      expect((await POST(invalidRequest)).status).toBe(400)
    }

    expect((await POST(makeRequest([makePackage(0)], { ip }))).status).toBe(200)
  })

  it('rate limits malformed requests before parsing', async () => {
    const ip = '203.0.113.14'
    for (let index = 0; index < 30; index++) {
      expect((await POST(makeRequest([], { ip }))).status).toBe(400)
    }

    expect((await POST(makeRequest([], { ip }))).status).toBe(429)
    expect(mockQueryOSV).not.toHaveBeenCalled()
  })

  it('rejects an oversized chunked JSON body before querying OSV', async () => {
    const request = new Request('http://localhost/api/deps/cve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.15',
      },
      body: JSON.stringify({ packages: [makePackage(0)], padding: 'x'.repeat(33_000) }),
    })

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(mockQueryOSV).not.toHaveBeenCalled()
  })

  it('exhausts the 60-query budget according to distinct tuple count', async () => {
    const ip = '203.0.113.12'
    const batch = Array.from({ length: 20 }, (_, index) => makePackage(index))

    expect((await POST(makeRequest(batch, { ip }))).status).toBe(200)
    expect((await POST(makeRequest(batch, { ip }))).status).toBe(200)
    expect((await POST(makeRequest(batch, { ip }))).status).toBe(200)

    const blocked = await POST(makeRequest([makePackage(20)], { ip }))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(mockQueryOSV).toHaveBeenCalledTimes(3)
  })

  it('charges duplicate tuples as one upstream query', async () => {
    const ip = '203.0.113.13'
    const duplicateBatch = Array.from({ length: 20 }, () => makePackage(0))
    const uniqueBatch = Array.from({ length: 20 }, (_, index) => makePackage(index + 1))

    expect((await POST(makeRequest(duplicateBatch, { ip }))).status).toBe(200)
    expect((await POST(makeRequest(duplicateBatch, { ip }))).status).toBe(200)
    expect((await POST(makeRequest(duplicateBatch, { ip }))).status).toBe(200)
    expect((await POST(makeRequest(uniqueBatch, { ip }))).status).toBe(200)
    expect((await POST(makeRequest(uniqueBatch, { ip }))).status).toBe(200)

    expect((await POST(makeRequest(uniqueBatch, { ip }))).status).toBe(429)
  })

  it('rejects an already-aborted request before reaching the OSV query boundary', async () => {
    const controller = new AbortController()
    const request = makeRequest([makePackage(0)], { signal: controller.signal })
    const reason = new DOMException('Client disconnected', 'AbortError')
    controller.abort(reason)

    await expect(POST(request)).rejects.toBe(reason)
    expect(mockQueryOSV).not.toHaveBeenCalled()
  })

  it('propagates cancellation while the OSV query is in flight', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Client disconnected', 'AbortError')
    mockQueryOSV.mockImplementation((_packages: PackageTuple[], signal: AbortSignal) => (
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    ))
    const pending = POST(makeRequest([makePackage(0)], { signal: controller.signal }))
    await vi.waitFor(() => expect(mockQueryOSV).toHaveBeenCalledOnce())

    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
  })

  it('rejects an oversized vulnerability response before sending it to the browser', async () => {
    mockQueryOSV.mockResolvedValue({
      results: [{
        packageName: 'package-0',
        version: '1.0.0',
        advisoryId: 'OSV-large',
        cveId: 'OSV-large',
        aliases: [],
        summary: 'x'.repeat(4 * 1024 * 1024),
        severity: 'unknown',
      }],
      errors: [],
      scannedPackages: 1,
    })

    const response = await POST(makeRequest([makePackage(0)]))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.objectContaining({ code: 'CVE_RESPONSE_TOO_LARGE' }),
    })
  })

  it('rejects a manifest range because OSV queries require an exact version', async () => {
    const response = await POST(makeRequest([{
      name: 'react',
      version: '^19.0.0',
      type: 'production',
    }]))

    expect(response.status).toBe(400)
    expect(mockQueryOSV).not.toHaveBeenCalled()
  })
})
