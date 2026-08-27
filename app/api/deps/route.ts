import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/error'
import {
  readBoundedJsonBody,
  readBoundedJsonResponse,
  ResponseBodyTooLargeError,
} from '@/lib/api/json-body'
import { applyRateLimit } from '@/lib/api/rate-limit'
import {
  MAX_DEPENDENCY_API_BATCH,
  MAX_DEPENDENCY_PACKAGES_PER_WINDOW,
  MAX_DEPENDENCY_REQUEST_BODY_BYTES,
  MAX_DEPENDENCY_REQUESTS_PER_WINDOW,
  MAX_NPM_DOWNLOAD_POINTS,
  MAX_NPM_DOWNLOAD_COUNT,
  MAX_NPM_DOWNLOAD_DAY_STRING_CHARS,
  MAX_NPM_DOWNLOADS_RESPONSE_BYTES,
  MAX_NPM_METADATA_RESPONSE_BYTES,
  MAX_NPM_METADATA_STRING_CHARS,
  MAX_NPM_VERSION_STRING_CHARS,
  MAX_NPM_WEEKLY_DOWNLOADS,
} from '@/lib/deps/constants'
import type { DepsApiResponse, DownloadPoint, NpmPackageMeta } from '@/lib/deps/types'

export const runtime = 'edge'
export const maxDuration = 60

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Only allow valid npm package names to prevent SSRF. */
const NPM_NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
export const depsRequestSchema = z.object({
  packages: z
    .array(z.string().regex(NPM_NAME_REGEX).max(214))
    .min(1)
    .max(MAX_DEPENDENCY_API_BATCH)
    .transform((packages) => [...new Set(packages)]),
})

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

/**
 * Run promises with a concurrency limit.
 * Returns settled results in the same order as input.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  shouldContinue: () => boolean = () => true,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length && shouldContinue()) {
      const i = index++
      try {
        const value = await fn(items[i])
        results[i] = { status: 'fulfilled', value }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// npm registry fetchers
// ---------------------------------------------------------------------------

const REGISTRY_TIMEOUT_MS = 10_000

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {})
}

function combineAbortSignals(signals: AbortSignal[]): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const listeners = new Map<AbortSignal, () => void>()
  let cleared = false

  const clear = () => {
    if (cleared) return
    cleared = true
    for (const [source, listener] of listeners) {
      source.removeEventListener('abort', listener)
    }
    listeners.clear()
  }

  const abortFrom = (signal: AbortSignal) => {
    clear()
    controller.abort(signal.reason)
  }

  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal)
      break
    }
    const listener = () => abortFrom(signal)
    listeners.set(signal, listener)
    signal.addEventListener('abort', listener, { once: true })
  }

  return { signal: controller.signal, clear }
}

function callerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function throwIfCallerAborted(signal: AbortSignal): void {
  if (signal.aborted) throw callerAbortReason(signal)
}

/** Reject promptly on disconnect while allowing settled workers to clean up. */
function raceCallerCancellation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(callerAbortReason(signal))

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(callerAbortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

function registryRequestSignal(requestSignal: AbortSignal): {
  signal: AbortSignal
  clear: () => void
} {
  const timeoutController = new AbortController()
  const timeout = setTimeout(
    () => timeoutController.abort(new DOMException('npm metadata request timed out', 'TimeoutError')),
    REGISTRY_TIMEOUT_MS,
  )
  const combined = combineAbortSignals([requestSignal, timeoutController.signal])
  return {
    signal: combined.signal,
    clear: () => {
      clearTimeout(timeout)
      combined.clear()
    },
  }
}

/**
 * Fetch full metadata for a single package from the npm registry.
 * Uses the `/latest` endpoint for compact response.
 */
async function fetchPackageMeta(
  name: string,
  requestSignal: AbortSignal,
): Promise<{
  version: string
  description: string
  license?: string
  maintainers: number
  repository?: string
  deprecated: boolean
  homepage?: string
}> {
  const request = registryRequestSignal(requestSignal)

  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: request.signal,
    })

    if (!res.ok) {
      await cancelResponseBody(res)
      throw new Error(`npm registry returned ${res.status} for ${name}`)
    }

    const { data } = await readBoundedJsonResponse<Record<string, unknown>>(res, MAX_NPM_METADATA_RESPONSE_BYTES)
    if (
      typeof data.version !== 'string'
      || data.version.trim() === ''
      || data.version.length > MAX_NPM_VERSION_STRING_CHARS
    ) {
      throw new Error(`npm registry returned incomplete metadata for ${name}`)
    }

    // Extract repository URL from various formats
    let repository: string | undefined
    const repo = data.repository as { url?: string } | string | undefined
    if (typeof repo === 'string') {
      repository = repo
    } else if (repo && typeof repo === 'object' && typeof repo.url === 'string') {
      repository = repo.url.replace(/^git\+/, '').replace(/\.git$/, '')
    }

    // Maintainers count
    const maintainers = Array.isArray(data.maintainers) ? data.maintainers.length : 0

    return {
      version: data.version,
      description: typeof data.description === 'string' ? data.description.slice(0, MAX_NPM_METADATA_STRING_CHARS) : '',
      license: typeof data.license === 'string' ? data.license.slice(0, MAX_NPM_METADATA_STRING_CHARS) : undefined,
      maintainers,
      repository: repository?.slice(0, MAX_NPM_METADATA_STRING_CHARS),
      deprecated: typeof data.deprecated === 'string' || data.deprecated === true,
      homepage: typeof data.homepage === 'string' ? data.homepage.slice(0, MAX_NPM_METADATA_STRING_CHARS) : undefined,
    }
  } finally {
    request.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface LatestPublication {
  version: string
  publishedAt: string
}

/** Fetch the latest-version publication record from npm's bounded search API. */
async function fetchLatestPublication(
  name: string,
  requestSignal: AbortSignal,
): Promise<LatestPublication | null> {
  const request = registryRequestSignal(requestSignal)

  try {
    const params = new URLSearchParams({ text: name, size: '20' })
    const url = `https://registry.npmjs.org/-/v1/search?${params}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: request.signal,
    })

    if (!res.ok) {
      await cancelResponseBody(res)
      throw new Error(`npm publication search returned ${res.status} for ${name}`)
    }

    let data: unknown
    try {
      ({ data } = await readBoundedJsonResponse<unknown>(res, MAX_NPM_METADATA_RESPONSE_BYTES))
    } catch (error) {
      if (error instanceof ResponseBodyTooLargeError) throw error
      return null
    }

    if (!isRecord(data) || !Array.isArray(data.objects) || data.objects.length > 20) return null
    const matches: LatestPublication[] = []
    for (const entry of data.objects) {
      if (!isRecord(entry) || !isRecord(entry.package) || entry.package.name !== name) continue
      const version = entry.package.version
      const date = entry.package.date
      if (
        typeof version !== 'string'
        || version.trim() === ''
        || version.length > MAX_NPM_VERSION_STRING_CHARS
        || typeof date !== 'string'
        || date.trim() === ''
      ) continue
      const publishedAtMs = Date.parse(date)
      if (!Number.isFinite(publishedAtMs)) continue
      matches.push({ version, publishedAt: new Date(publishedAtMs).toISOString() })
    }
    if (matches.length === 0) return null
    const [first] = matches
    return matches.every(match => (
      match.version === first.version && match.publishedAt === first.publishedAt
    )) ? first : null
  } finally {
    request.clear()
  }
}

/**
 * Fetch download stats for a package (last month, daily breakdown).
 */
async function fetchDownloads(
  name: string,
  requestSignal: AbortSignal,
): Promise<{ weeklyDownloads: number; downloadTrend: DownloadPoint[] }> {
  const request = registryRequestSignal(requestSignal)

  try {
    const url = `https://api.npmjs.org/downloads/range/last-month/${encodeURIComponent(name)}`
    const res = await fetch(url, { signal: request.signal })

    if (!res.ok) {
      await cancelResponseBody(res)
      throw new Error(`npm download metadata returned ${res.status} for ${name}`)
    }

    const { data } = await readBoundedJsonResponse<{
      downloads?: Array<{ day: string; downloads: number }>
    }>(res, MAX_NPM_DOWNLOADS_RESPONSE_BYTES)

    if (!Array.isArray(data.downloads)) {
      throw new Error(`npm download metadata was incomplete for ${name}`)
    }
    if (data.downloads.length > MAX_NPM_DOWNLOAD_POINTS) {
      throw new Error(`npm download metadata exceeded ${MAX_NPM_DOWNLOAD_POINTS} points for ${name}`)
    }
    const points: DownloadPoint[] = data.downloads.map((d) => {
      if (
        typeof d?.day !== 'string'
        || d.day.length === 0
        || d.day.length > MAX_NPM_DOWNLOAD_DAY_STRING_CHARS
        || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)
        || typeof d.downloads !== 'number'
        || !Number.isSafeInteger(d.downloads)
        || d.downloads < 0
        || d.downloads > MAX_NPM_DOWNLOAD_COUNT
      ) {
        throw new Error(`npm download metadata was incomplete for ${name}`)
      }
      return { day: d.day, downloads: d.downloads }
    })

    // Weekly downloads = sum of last 7 days
    const lastWeek = points.slice(-7)
    const weeklyDownloads = lastWeek.reduce((sum, p) => sum + p.downloads, 0)
    if (!Number.isSafeInteger(weeklyDownloads) || weeklyDownloads > MAX_NPM_WEEKLY_DOWNLOADS) {
      throw new Error(`npm download metadata had an unsafe weekly aggregate for ${name}`)
    }

    return { weeklyDownloads, downloadTrend: points }
  } finally {
    request.clear()
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const requestRateLimited = applyRateLimit(req, {
    bucket: '/api/deps:requests',
    limit: MAX_DEPENDENCY_REQUESTS_PER_WINDOW,
  })
  if (requestRateLimited) return requestRateLimited

  const body = await readBoundedJsonBody(req, MAX_DEPENDENCY_REQUEST_BODY_BYTES)
  if (!body.success) return body.response
  throwIfCallerAborted(req.signal)

  const parsed = depsRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Invalid request body',
      422,
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const { packages } = parsed.data
  const rateLimitResponse = applyRateLimit(req, {
    bucket: '/api/deps',
    limit: MAX_DEPENDENCY_PACKAGES_PER_WINDOW * 3,
    cost: packages.length * 3,
  })
  if (rateLimitResponse) return rateLimitResponse
  const results: Record<string, NpmPackageMeta> = {}
  const errors: string[] = []
  let rateLimited = false

  const settled = await raceCallerCancellation(mapWithConcurrency(packages, 10, async (name) => {
    if (rateLimited) {
      throw new Error(`Skipped ${name}: rate limited`)
    }

    try {
      // Fetch metadata and downloads in parallel
      const [meta, downloads, latestPublication] = await Promise.all([
        fetchPackageMeta(name, req.signal),
        fetchDownloads(name, req.signal),
        fetchLatestPublication(name, req.signal),
      ])
      const lastPublish = latestPublication?.version === meta.version
        ? latestPublication.publishedAt
        : null

      return { name, meta, downloads, lastPublish }
    } catch (err) {
      if (err instanceof Error && err.message.includes('429')) {
        rateLimited = true
      }
      throw err
    }
  }, () => !req.signal.aborted), req.signal)
  throwIfCallerAborted(req.signal)

  for (const result of settled) {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)

      // Detect rate limiting or skipped-due-to-rate-limit
      if (reason.includes('429') || reason.includes('rate limited')) {
        errors.push('npm registry rate limit reached — some packages were skipped')
      } else {
        errors.push(reason)
      }
      continue
    }

    const { name, meta, downloads, lastPublish } = result.value

    results[name] = {
      name,
      version: meta.version,
      description: meta.description,
      license: meta.license,
      maintainers: meta.maintainers,
      repository: meta.repository,
      lastPublish,
      weeklyDownloads: downloads.weeklyDownloads,
      downloadTrend: downloads.downloadTrend,
      deprecated: meta.deprecated,
      homepage: meta.homepage,
    }
  }

  const response: DepsApiResponse = { results, errors: [...new Set(errors)] }
  throwIfCallerAborted(req.signal)
  return NextResponse.json(response)
}
