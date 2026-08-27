import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NpmPackageMeta, DepsApiResponse } from '../types'

// ---------------------------------------------------------------------------
// Mock the memory-cache module — default: always cache-miss
// ---------------------------------------------------------------------------

vi.mock('@/lib/cache/memory-cache', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
}))

// Import after mocking
import { fetchDependencyMeta } from '../npm-client'
import { getCached, setCache } from '@/lib/cache/memory-cache'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(name: string): NpmPackageMeta {
  return {
    name,
    version: '1.0.0',
    description: `Package ${name}`,
    license: 'MIT',
    maintainers: 1,
    lastPublish: '2026-03-01T00:00:00Z',
    weeklyDownloads: 10_000,
    downloadTrend: [],
    deprecated: false,
  }
}

function mockFetchSuccess(results: Record<string, NpmPackageMeta>, errors: string[] = []) {
  const response: DepsApiResponse = { results, errors }
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  })
}

function mockFetchFailure(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchDependencyMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-establish default cache-miss behavior after restoreAllMocks in setup.ts
    vi.mocked(getCached).mockReturnValue(null)
    vi.mocked(setCache).mockImplementation(() => {})
  })

  it('returns empty Map for empty packages array', async () => {
    const result = await fetchDependencyMeta([])
    expect(result.size).toBe(0)
  })

  it('calls /api/deps with correct payload and returns parsed Map', async () => {
    const reactMeta = makeMeta('react')
    globalThis.fetch = mockFetchSuccess({ react: reactMeta })

    const result = await fetchDependencyMeta(['react'])

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: ['react'] }),
    })
    expect(result.size).toBe(1)
    expect(result.get('react')).toEqual(reactMeta)
  })

  it('caches fetched results and returns cached data on second call', async () => {
    const reactMeta = makeMeta('react')
    globalThis.fetch = mockFetchSuccess({ react: reactMeta })

    // First call — fetches from API
    const result1 = await fetchDependencyMeta(['react'])
    expect(result1.get('react')).toEqual(reactMeta)
    expect(setCache).toHaveBeenCalled()

    // Second call — should use cache, no new fetch
    vi.mocked(getCached).mockReturnValue(reactMeta)
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy

    const result2 = await fetchDependencyMeta(['react'])
    expect(result2.get('react')).toEqual(reactMeta)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns empty Map and does not throw on fetch failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.fetch = mockFetchFailure(500)

    const result = await fetchDependencyMeta(['nonexistent-pkg'])

    expect(result.size).toBe(0)
  })

  it('returns empty Map on network error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'))

    const result = await fetchDependencyMeta(['react'])

    expect(result.size).toBe(0)
  })

  it('returns successful results when some packages have errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reactMeta = makeMeta('react')
    globalThis.fetch = mockFetchSuccess(
      { react: reactMeta },
      ['Failed to fetch nonexistent-pkg'],
    )

    const result = await fetchDependencyMeta(['react', 'nonexistent-pkg'])

    expect(result.size).toBe(1)
    expect(result.get('react')).toEqual(reactMeta)
  })

  it('keeps every metadata request within the 20-package API contract', async () => {
    const packages = Array.from({ length: 45 }, (_, i) => `pkg-${i}`)
    const results: Record<string, NpmPackageMeta> = {}
    for (const name of packages) {
      results[name] = makeMeta(name)
    }

    // Mock fetch to return results for each batch
    const batchSizes: number[] = []
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { packages: string[] }
      batchSizes.push(body.packages.length)
      const batchResults: Record<string, NpmPackageMeta> = {}
      for (const name of body.packages) {
        batchResults[name] = results[name]
      }
      return {
        ok: true,
        json: () => Promise.resolve({ results: batchResults, errors: [] }),
      }
    })

    const result = await fetchDependencyMeta(packages)

    expect(batchSizes).toEqual([20, 20, 5])
    expect(result.size).toBe(45)
  })

  it('stops scheduling metadata batches after cancellation', async () => {
    const controller = new AbortController()
    const packages = Array.from({ length: 21 }, (_, i) => `pkg-${i}`)
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      controller.abort()
      return {
        ok: true,
        json: () => Promise.resolve({ results: {}, errors: [] }),
      }
    })

    await (fetchDependencyMeta as unknown as (
      packages: string[],
      options: { signal: AbortSignal },
    ) => Promise<Map<string, NpmPackageMeta>>)(packages, { signal: controller.signal })

    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it('does not schedule metadata beyond the 60-package workflow budget', async () => {
    const packages = Array.from({ length: 61 }, (_, index) => `pkg-${index}`)
    const batchSizes: number[] = []
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { packages: string[] }
      batchSizes.push(body.packages.length)
      return {
        ok: true,
        json: () => Promise.resolve({ results: {}, errors: [] }),
      }
    })

    await fetchDependencyMeta(packages)

    expect(batchSizes).toEqual([20, 20, 20])
  })

  it('mixes cached and uncached packages correctly', async () => {
    const reactMeta = makeMeta('react')
    const vueMeta = makeMeta('vue')

    // Pre-cache react via getCached returning a value for that key
    vi.mocked(getCached).mockImplementation((key: string) => {
      if (key === 'deps:react') return reactMeta as never
      return null
    })

    // Only vue should be fetched
    globalThis.fetch = mockFetchSuccess({ vue: vueMeta })

    const result = await fetchDependencyMeta(['react', 'vue'])

    expect(result.size).toBe(2)
    expect(result.get('react')).toEqual(reactMeta)
    expect(result.get('vue')).toEqual(vueMeta)

    // fetch was only called for the uncached 'vue'
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(body.packages).toEqual(['vue'])
  })

  it('reports network failures for every package in the failed batch', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Registry unavailable'))
    const errors: Array<{ packageName: string; message: string }> = []

    const result = await fetchDependencyMeta(['react', 'vue'], {
      onError: (packageName, message) => errors.push({ packageName, message }),
    })

    expect(result).toEqual(new Map())
    expect(errors).toEqual([
      { packageName: 'react', message: 'Registry unavailable' },
      { packageName: 'vue', message: 'Registry unavailable' },
    ])
  })

  it('reports API errors even when the batch also returns metadata', async () => {
    const reactMeta = makeMeta('react')
    globalThis.fetch = mockFetchSuccess(
      { react: reactMeta },
      ['npm registry returned a warning for react'],
    )
    const errors: Array<{ packageName: string; message: string }> = []

    const result = await fetchDependencyMeta(['react', 'vue'], {
      onError: (packageName, message) => errors.push({ packageName, message }),
    })

    expect(result.get('react')).toEqual(reactMeta)
    expect(errors).toEqual([
      {
        packageName: 'react',
        message: 'npm registry returned a warning for react',
      },
    ])
  })

  it('does not attribute a package error to a shorter package-name prefix', async () => {
    const fooMeta = makeMeta('foo')
    globalThis.fetch = mockFetchSuccess(
      { foo: fooMeta },
      ['npm registry returned 404 for foobar'],
    )
    const errors: Array<{ packageName: string; message: string }> = []

    await fetchDependencyMeta(['foo', 'foobar'], {
      onError: (packageName, message) => errors.push({ packageName, message }),
    })

    expect(errors).toEqual([{
      packageName: 'foobar',
      message: 'npm registry returned 404 for foobar',
    }])
  })
})
