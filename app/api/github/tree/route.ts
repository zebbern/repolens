import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { fetchRepoTree } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

export const runtime = 'edge'

const treeQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  sha: z.string().min(1).default("HEAD"),
})

export const GET = withGitHubCachePolicy(async function GET(request: NextRequest, token: string | undefined) {
  const rateLimited = applyRateLimit(request)
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
    })

    return NextResponse.json(tree)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch tree"
    return apiError('GITHUB_ERROR', message, 500)
  }
}, 's-maxage=600, stale-while-revalidate=120')
