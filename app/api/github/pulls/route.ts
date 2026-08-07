import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { getGitHubCacheHeaders } from "@/lib/api/github-cache"
import { fetchPulls } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const pullsQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  state: z.enum(['open', 'closed', 'all']).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
})

export async function GET(request: NextRequest) {
  const rateLimited = applyRateLimit(request)
  if (rateLimited) return rateLimited

  const params = pullsQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
    state: request.nextUrl.searchParams.get("state") ?? undefined,
    per_page: request.nextUrl.searchParams.get("per_page") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    sort: request.nextUrl.searchParams.get("sort") ?? undefined,
    direction: request.nextUrl.searchParams.get("direction") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name, state, per_page, page, sort, direction } = params.data

  try {
    const token = await getAccessToken(request)

    const pulls = await fetchPulls(owner, name, {
      token,
      state,
      perPage: per_page,
      page,
      sort,
      direction,
    })

    return NextResponse.json(pulls, {
      headers: getGitHubCacheHeaders(token, 's-maxage=60, stale-while-revalidate=30'),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch pull requests"

    if (message.includes("not found")) {
      return apiError('REPO_NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    return apiError('GITHUB_ERROR', message, 500)
  }
}
