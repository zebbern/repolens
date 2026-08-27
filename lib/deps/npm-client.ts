/**
 * Client-side npm metadata fetcher.
 * Calls the /api/deps proxy route and caches results in memory-cache.
 */

import { getCached, setCache } from '@/lib/cache/memory-cache'
import {
  MAX_DEPENDENCY_API_BATCH,
  MAX_DEPENDENCY_PACKAGES_PER_WINDOW,
} from './constants'
import type { DepsApiResponse, NpmPackageMeta } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1_000 // 10 minutes

export interface FetchDependencyMetaOptions {
  signal?: AbortSignal
  onError?: (packageName: string, message: string) => void
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function cacheKey(packageName: string): string {
  return `deps:${packageName}`
}

// ---------------------------------------------------------------------------
// Fetch logic
// ---------------------------------------------------------------------------

/**
 * Fetch npm metadata for a list of packages via the /api/deps proxy.
 * Results are cached per-package in memory-cache with 10min TTL.
 * Returns a Map keyed by package name; failed packages are omitted.
 */
export async function fetchDependencyMeta(
  packages: string[],
  options: FetchDependencyMetaOptions = {},
): Promise<Map<string, NpmPackageMeta>> {
  if (packages.length === 0) return new Map()

  const results = new Map<string, NpmPackageMeta>()
  const uncached: string[] = []

  // Check cache first
  for (const name of packages) {
    const cached = getCached<NpmPackageMeta>(cacheKey(name))
    if (cached) {
      results.set(name, cached)
    } else {
      uncached.push(name)
    }
  }

  if (uncached.length === 0) return results

  const fetchable = uncached.slice(0, MAX_DEPENDENCY_PACKAGES_PER_WINDOW)

  // Fetch uncached packages in batches to respect API limits
  for (let i = 0; i < fetchable.length; i += MAX_DEPENDENCY_API_BATCH) {
    if (options.signal?.aborted) break
    const batch = fetchable.slice(i, i + MAX_DEPENDENCY_API_BATCH)

    try {
      const response = await fetch('/api/deps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: batch }),
        ...(options.signal && { signal: options.signal }),
      })

      if (!response.ok) {
        const message = `/api/deps returned ${response.status}`
        for (const name of batch) options.onError?.(name, message)
        console.warn(
          `[npm-client] ${message} for batch starting at index ${i}`,
        )
        continue
      }

      const data = (await response.json()) as DepsApiResponse

      // Cache and collect results
      for (const [name, meta] of Object.entries(data.results)) {
        setCache(cacheKey(name), meta, CACHE_TTL_MS)
        results.set(name, meta)
      }

      if (data.errors.length > 0) {
        console.warn('[npm-client] Partial fetch errors:', data.errors)
        for (const message of data.errors) {
          const matched = batch.filter(name => (
            message.endsWith(`for ${name}`) || message.includes(`Skipped ${name}:`)
          ))
          const targets = matched.length > 0
            ? matched
            : batch.filter(name => !Object.prototype.hasOwnProperty.call(data.results, name))
          for (const name of targets) options.onError?.(name, message)
        }
      }
    } catch (error) {
      if (options.signal?.aborted) break
      const message = error instanceof Error ? error.message : String(error)
      for (const name of batch) options.onError?.(name, message)
      console.warn(`[npm-client] Failed to fetch batch: ${message}`)
      // Continue with remaining batches — partial results are acceptable
    }
  }

  return results
}
