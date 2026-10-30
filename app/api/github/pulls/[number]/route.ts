import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { fetchPullRequest } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { gitHubErrorResponse } from "@/lib/api/github-error-response"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const prQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
})

export const GET = withGitHubCachePolicy(async function GET(
  request: NextRequest,
  token: string | undefined,
  { params }: { params: Promise<{ number: string }> },
) {
  const rateLimited = applyRateLimit(request, { bucket: '/api/github/pulls/[number]' })
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
    const pr = await fetchPullRequest(owner, name, prNumber, { token, signal: request.signal })
    return NextResponse.json(pr)
  } catch (error) {
    return gitHubErrorResponse(request, error, {
      tag: 'pull-request',
      fallback: 'Failed to fetch pull request',
      notFoundCode: 'NOT_FOUND',
    })
  }
}, 's-maxage=60, stale-while-revalidate=30')
