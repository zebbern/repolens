import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/error'
import { applyRateLimit } from '@/lib/api/rate-limit'
import type { DepsApiResponse, DownloadPoint, NpmPackageMeta } from '@/lib/deps/types'

export const runtime = 'edge'
export const maxDuration = 60

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Only allow valid npm package names to prevent SSRF. */
const NPM_NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

const depsRequestSchema = z.object({
  packages: z
    .array(z.string().regex(NPM_NAME_REGEX).max(214))
    .min(1)
    .max(200),
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
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
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

/**
 * Fetch full metadata for a single package from the npm registry.
 * Uses the `/latest` endpoint for compact response.
 */
async function fetchPackageMeta(
  name: string,
): Promise<{
  version: string
  description: string
  license?: string
  maintainers: number
  repository?: string
  deprecated: boolean
  homepage?: string
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)

  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`npm registry returned ${res.status} for ${name}`)
    }

    const data = (await res.json()) as Record<string, unknown>

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
      version: typeof data.version === 'string' ? data.version : '0.0.0',
      description: typeof data.description === 'string' ? data.description : '',
      license: typeof data.license === 'string' ? data.license : undefined,
      maintainers,
      repository,
      deprecated: typeof data.deprecated === 'string' || data.deprecated === true,
      homepage: typeof data.homepage === 'string' ? data.homepage : undefined,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fetch the full registry document for last-publish time.
 * We only request the `time` field to keep it lightweight.
 */
async function fetchLastPublishTime(name: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)

  try {
    // Abbreviated metadata includes modified date
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
      signal: controller.signal,
    })

    if (!res.ok) return new Date().toISOString()

    const data = (await res.json()) as { modified?: string }
    return typeof data.modified === 'string' ? data.modified : new Date().toISOString()
  } catch {
    return new Date().toISOString()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fetch download stats for a package (last month, daily breakdown).
 */
async function fetchDownloads(
  name: string,
): Promise<{ weeklyDownloads: number; downloadTrend: DownloadPoint[] }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)

  try {
    const url = `https://api.npmjs.org/downloads/range/last-month/${encodeURIComponent(name)}`
    const res = await fetch(url, { signal: controller.signal })

    if (!res.ok) {
      return { weeklyDownloads: 0, downloadTrend: [] }
    }

    const data = (await res.json()) as {
      downloads?: Array<{ day: string; downloads: number }>
    }

    const points: DownloadPoint[] = Array.isArray(data.downloads)
      ? data.downloads.map((d) => ({ day: d.day, downloads: d.downloads }))
      : []

    // Weekly downloads = sum of last 7 days
    const lastWeek = points.slice(-7)
    const weeklyDownloads = lastWeek.reduce((sum, p) => sum + p.downloads, 0)

    return { weeklyDownloads, downloadTrend: points }
  } catch {
    return { weeklyDownloads: 0, downloadTrend: [] }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const rateLimitResponse = applyRateLimit(req, { bucket: '/api/deps' })
  if (rateLimitResponse) return rateLimitResponse

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiError('INVALID_JSON', 'Invalid JSON in request body', 400)
  }

  const parsed = depsRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Invalid request body',
      422,
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const { packages } = parsed.data
  const results: Record<string, NpmPackageMeta> = {}
  const errors: string[] = []
  let rateLimited = false

  const settled = await mapWithConcurrency(packages, 10, async (name) => {
    if (rateLimited) {
      throw new Error(`Skipped ${name}: rate limited`)
    }

    try {
      // Fetch metadata and downloads in parallel
      const [meta, downloads, lastPublish] = await Promise.all([
        fetchPackageMeta(name),
        fetchDownloads(name),
        fetchLastPublishTime(name),
      ])

      return { name, meta, downloads, lastPublish }
    } catch (err) {
      if (err instanceof Error && err.message.includes('429')) {
        rateLimited = true
      }
      throw err
    }
  })

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
  return NextResponse.json(response)
}
