import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/error'
import { queryOSV } from '@/lib/code/scanner/cve-lookup'

export const maxDuration = 30

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Only allow valid npm package names to prevent SSRF / injection. */
const NPM_NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

const cveRequestSchema = z.object({
  packages: z
    .array(
      z.object({
        name: z.string().regex(NPM_NAME_REGEX).max(214),
        version: z.string().max(256),
        type: z.enum(['production', 'dev']),
      }),
    )
    .min(1)
    .max(1000),
})

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_JSON', 'Request body must be valid JSON', 400)
  }

  const parsed = cveRequestSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Invalid request body',
      400,
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  try {
    const result = await queryOSV(parsed.data.packages)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/deps/cve] CVE lookup failed:', message)
    return apiError('CVE_LOOKUP_FAILED', 'Failed to query vulnerability database', 502)
  }
}
