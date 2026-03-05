import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { getAccessToken } from "@/lib/auth/token"
import { fetchBlame } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"

const blameBodySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  ref: z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/, 'Invalid ref'),
  path: z.string().min(1).max(4096),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }

  const params = blameBodySchema.safeParse(body)

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing or invalid parameters: owner, name, ref, path', 400)
  }

  const { owner, name, ref, path } = params.data

  try {
    const token = await getAccessToken(request)

    if (!token) {
      return apiError('AUTH_REQUIRED', 'Authentication required to access blame data', 401)
    }

    const data = await fetchBlame(owner, name, ref, path, { token })

    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch blame data"

    if (message.includes("not found")) {
      return apiError('NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }
    if (message.includes("Authentication")) {
      return apiError('AUTH_REQUIRED', message, 401)
    }

    console.error('[blame] GitHub API error:', message)
    return apiError('GITHUB_ERROR', 'Failed to fetch blame data', 500)
  }
}
