import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { fetchRepoMetadata } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { gitHubErrorResponse } from "@/lib/api/github-error-response"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const repoQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
})

export const GET = withGitHubCachePolicy(async function GET(request: NextRequest, token: string | undefined) {
  const rateLimited = applyRateLimit(request, { bucket: '/api/github/repo' })
  if (rateLimited) return rateLimited

  const params = repoQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name } = params.data

  try {
    const repo = await fetchRepoMetadata(owner, name, {
      token,
      signal: request.signal,
    })

    return NextResponse.json(repo)
  } catch (error) {
    return gitHubErrorResponse(request, error, {
      tag: 'repo',
      fallback: 'Failed to fetch repository',
      notFoundCode: 'REPO_NOT_FOUND',
    })
  }
}, 's-maxage=300, stale-while-revalidate=60')
