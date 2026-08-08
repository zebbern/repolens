import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { fetchPullRequestComments } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const commentsQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
})

export const GET = withGitHubCachePolicy(async function GET(
  request: NextRequest,
  token: string | undefined,
  { params }: { params: Promise<{ number: string }> },
) {
  const rateLimited = applyRateLimit(request, { bucket: '/api/github/pulls/[number]/comments' })
  if (rateLimited) return rateLimited

  const { number: numberStr } = await params
  const prNumber = Number(numberStr)
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    return apiError('VALIDATION_ERROR', 'Invalid pull request number', 400)
  }

  const query = commentsQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
    per_page: request.nextUrl.searchParams.get("per_page") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
  })

  if (!query.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name, per_page, page } = query.data

  try {
    const comments = await fetchPullRequestComments(owner, name, prNumber, {
      token,
      perPage: per_page,
      page,
    })
    return NextResponse.json(comments)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch pull request comments"

    if (message.includes("not found")) {
      return apiError('NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    return apiError('GITHUB_ERROR', message, 500)
  }
}, 's-maxage=60, stale-while-revalidate=30')
