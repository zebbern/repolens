import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { fetchBranches } from "@/lib/github/fetcher"
import { GITHUB_LIST_MAX_PAGES, githubPagesFetched } from "@/lib/github/pagination"
import { apiError } from "@/lib/api/error"
import { gitHubErrorResponse } from "@/lib/api/github-error-response"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit, refundRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const branchesQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
})

export const GET = withGitHubCachePolicy(async function GET(request: NextRequest, token: string | undefined) {
  // Admit at the worst-case page walk; a completed walk refunds the pages it
  // did not use, while an aborted or failed one keeps the full charge.
  const rateLimited = applyRateLimit(request, { bucket: '/api/github/branches', cost: GITHUB_LIST_MAX_PAGES })
  if (rateLimited) return rateLimited

  const params = branchesQuerySchema.safeParse({
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
    const branches = await fetchBranches(owner, name, {
      token,
      perPage: per_page,
      page,
      signal: request.signal,
    })

    const unusedPages = GITHUB_LIST_MAX_PAGES - githubPagesFetched(branches.items.length, per_page)
    if (unusedPages > 0) refundRateLimit(request, { bucket: '/api/github/branches', cost: unusedPages })

    return NextResponse.json({ branches: branches.items, truncated: branches.truncated })
  } catch (error) {
    return gitHubErrorResponse(request, error, {
      tag: 'branches',
      fallback: 'Failed to fetch branches',
      notFoundCode: 'REPO_NOT_FOUND',
    })
  }
}, 's-maxage=300, stale-while-revalidate=60')
