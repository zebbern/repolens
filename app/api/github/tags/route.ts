import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { fetchTags } from "@/lib/github/fetcher"
import { GITHUB_LIST_MAX_PAGES, githubPagesFetched } from "@/lib/github/pagination"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit, refundRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const tagsQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
})

export const GET = withGitHubCachePolicy(async function GET(request: NextRequest, token: string | undefined) {
  // Admit at the worst-case page walk; a completed walk refunds the pages it
  // did not use, while an aborted or failed one keeps the full charge.
  const rateLimited = applyRateLimit(request, { bucket: '/api/github/tags', cost: GITHUB_LIST_MAX_PAGES })
  if (rateLimited) return rateLimited

  const params = tagsQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
    per_page: request.nextUrl.searchParams.get("per_page") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name, per_page, page } = params.data

  try {
    const tags = await fetchTags(owner, name, {
      token,
      perPage: per_page,
      page,
      signal: request.signal,
    })

    const unusedPages = GITHUB_LIST_MAX_PAGES - githubPagesFetched(tags.items.length, per_page)
    if (unusedPages > 0) refundRateLimit(request, { bucket: '/api/github/tags', cost: unusedPages })

    return NextResponse.json({ tags: tags.items, truncated: tags.truncated })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch tags"

    if (message.includes("not found")) {
      return apiError('REPO_NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    console.error('[tags] GitHub API error:', message)
    return apiError('GITHUB_ERROR', 'Failed to fetch tags', 500)
  }
}, 's-maxage=600, stale-while-revalidate=120')
