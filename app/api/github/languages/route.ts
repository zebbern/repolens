import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { fetchRepoLanguages } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const languagesQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
})

export const GET = withGitHubCachePolicy(async function GET(request: NextRequest, token: string | undefined) {
  const rateLimited = applyRateLimit(request, { bucket: '/api/github/languages' })
  if (rateLimited) return rateLimited

  const params = languagesQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name } = params.data

  try {
    const languages = await fetchRepoLanguages(owner, name, { token })

    return NextResponse.json(languages)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch languages"

    if (message.includes("not found")) {
      return apiError('REPO_NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    return apiError('GITHUB_ERROR', message, 500)
  }
}, 's-maxage=600, stale-while-revalidate=120')
