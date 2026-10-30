import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { getAccessToken } from "@/lib/auth/token"
import { fetchBlame } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { gitHubErrorResponse } from "@/lib/api/github-error-response"
import { readBoundedJsonBody } from "@/lib/api/json-body"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'
const MAX_BLAME_REQUEST_BODY_BYTES = 32 * 1024

const blameBodySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  ref: z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/, 'Invalid ref'),
  path: z.string().min(1).max(4096),
})

export async function POST(request: NextRequest) {
  const rateLimited = applyRateLimit(request, { bucket: '/api/github/blame' })
  if (rateLimited) return rateLimited

  const body = await readBoundedJsonBody(request, MAX_BLAME_REQUEST_BODY_BYTES)
  if (!body.success) return body.response

  const params = blameBodySchema.safeParse(body.data)

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing or invalid parameters: owner, name, ref, path', 400)
  }

  const { owner, name, ref, path } = params.data

  try {
    const token = await getAccessToken(request)

    if (!token) {
      return apiError('AUTH_REQUIRED', 'Authentication required to access blame data', 401)
    }

    const data = await fetchBlame(owner, name, ref, path, { token, signal: request.signal })

    return NextResponse.json(data)
  } catch (error) {
    return gitHubErrorResponse(request, error, {
      tag: 'blame',
      fallback: 'Failed to fetch blame data',
      notFoundCode: 'NOT_FOUND',
    })
  }
}
