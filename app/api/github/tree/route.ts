import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { fetchRepoTree } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { gitHubErrorResponse } from "@/lib/api/github-error-response"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"
import { TREE_RESOLUTION_MAX_REQUESTS } from "@/lib/github/tree-resolver"

export const runtime = 'edge'
export const TREE_ROUTE_RATE_COST = TREE_RESOLUTION_MAX_REQUESTS

const treeQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  sha: z.string().min(1).default("HEAD"),
})

export const GET = withGitHubCachePolicy(async function GET(request: NextRequest, token: string | undefined) {
  const rateLimited = applyRateLimit(request, {
    bucket: '/api/github/tree',
    cost: TREE_ROUTE_RATE_COST,
  })
  if (rateLimited) return rateLimited

  const params = treeQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
    sha: request.nextUrl.searchParams.get("sha") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name, sha } = params.data

  try {
    const tree = await fetchRepoTree(owner, name, sha, {
      token,
      signal: request.signal,
    })

    // A tree cut short by a failed or slow request may resolve fully next time,
    // so it must not be shared through the CDN; budget-limited trees can be.
    const transient = tree.status === 'partial'
      && tree.reasons.some(reason => reason === 'fetch-failed' || reason === 'time-budget-exceeded')
    return NextResponse.json(tree, transient ? { headers: { 'CDN-Cache-Control': 'no-store' } } : undefined)
  } catch (error) {
    // Upstream failures arrive as a partial tree; this catches aborts and the unexpected.
    return gitHubErrorResponse(request, error, { tag: 'tree', fallback: 'Failed to fetch tree' })
  }
}, 's-maxage=600, stale-while-revalidate=120')
