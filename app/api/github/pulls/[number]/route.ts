import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { getGitHubCacheHeaders } from "@/lib/api/github-cache"
import { fetchPullRequest } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const prQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const rateLimited = applyRateLimit(request)
  if (rateLimited) return rateLimited

  const { number: numberStr } = await params
  const prNumber = Number(numberStr)
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    return apiError('VALIDATION_ERROR', 'Invalid pull request number', 400)
  }

  const query = prQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
  })

  if (!query.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name } = query.data

  try {
    const token = await getAccessToken(request)
    const pr = await fetchPullRequest(owner, name, prNumber, { token })
    return NextResponse.json(pr, {
      headers: getGitHubCacheHeaders(token, 's-maxage=60, stale-while-revalidate=30'),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch pull request"

    if (message.includes("not found")) {
      return apiError('NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    return apiError('GITHUB_ERROR', message, 500)
  }
}
