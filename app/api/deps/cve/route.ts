import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/error'
import { readBoundedJsonBody } from '@/lib/api/json-body'
import { applyRateLimit } from '@/lib/api/rate-limit'
import { queryOSV } from '@/lib/code/scanner/cve-lookup'
import {
  MAX_DEPENDENCY_API_BATCH,
  MAX_DEPENDENCY_PACKAGES_PER_WINDOW,
  MAX_DEPENDENCY_REQUEST_BODY_BYTES,
  MAX_DEPENDENCY_REQUESTS_PER_WINDOW,
} from '@/lib/deps/constants'

export const runtime = 'edge'
export const maxDuration = 30

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Only allow valid npm package names to prevent SSRF / injection. */
const NPM_NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const NPM_EXACT_VERSION_REGEX = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const CVE_QUERY_BUDGET = MAX_DEPENDENCY_PACKAGES_PER_WINDOW
const MAX_CVE_RESPONSE_BYTES = 4 * 1024 * 1024

const cveRequestSchema = z.object({
  packages: z
    .array(
      z.object({
        name: z.string().regex(NPM_NAME_REGEX).max(214),
        version: z.string().regex(NPM_EXACT_VERSION_REGEX, 'Version must be an exact semantic version').max(256),
        type: z.enum(['production', 'dev']),
      }),
    )
    .min(1)
    .max(MAX_DEPENDENCY_API_BATCH),
})

function dedupePackages(packages: z.infer<typeof cveRequestSchema>['packages']) {
  const uniquePackages = new Map<string, (typeof packages)[number]>()
  for (const packageDependency of packages) {
    const key = JSON.stringify([
      packageDependency.name,
      packageDependency.version,
      packageDependency.type,
    ])
    if (!uniquePackages.has(key)) uniquePackages.set(key, packageDependency)
  }
  return [...uniquePackages.values()]
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  const requestRateLimited = applyRateLimit(request, {
    bucket: '/api/deps/cve:requests',
    limit: MAX_DEPENDENCY_REQUESTS_PER_WINDOW,
  })
  if (requestRateLimited) return requestRateLimited

  const body = await readBoundedJsonBody(request, MAX_DEPENDENCY_REQUEST_BODY_BYTES)
  if (!body.success) return body.response

  const parsed = cveRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Invalid request body',
      400,
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const packages = dedupePackages(parsed.data.packages)
  const rateLimited = applyRateLimit(request, {
    bucket: '/api/deps/cve',
    limit: CVE_QUERY_BUDGET,
    cost: packages.length,
  })
  if (rateLimited) return rateLimited

  try {
    const result = await queryOSV(packages, request.signal)
    if (request.signal.aborted) {
      throw request.signal.reason ?? new DOMException('Client disconnected', 'AbortError')
    }
    const responseBody = JSON.stringify(result)
    if (new TextEncoder().encode(responseBody).byteLength > MAX_CVE_RESPONSE_BYTES) {
      return apiError(
        'CVE_RESPONSE_TOO_LARGE',
        'Vulnerability response exceeds the maximum size',
        502,
      )
    }
    return new NextResponse(responseBody, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (request.signal.aborted) {
      throw request.signal.reason ?? new DOMException('Client disconnected', 'AbortError')
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/deps/cve] CVE lookup failed:', message)
    return apiError('CVE_LOOKUP_FAILED', 'Failed to query vulnerability database', 502)
  }
}
