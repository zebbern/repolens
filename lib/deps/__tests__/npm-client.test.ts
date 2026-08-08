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

  it('splits large package lists into batches of 200', async () => {
    const packages = Array.from({ length: 250 }, (_, i) => `pkg-${i}`)
    const results: Record<string, NpmPackageMeta> = {}
    for (const name of packages) {
      results[name] = makeMeta(name)
    }

    // Mock fetch to return results for each batch
    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      callCount++
      const body = JSON.parse(init.body as string) as { packages: string[] }
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

    // Should have made 2 requests: 200 + 50
    expect(callCount).toBe(2)
    expect(result.size).toBe(250)
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
})
