import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { fetchCommits } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/

const commitsQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  sha: z.string().optional(),
  since: z.string().regex(ISO_DATE_RE, 'Invalid date format').optional(),
  until: z.string().regex(ISO_DATE_RE, 'Invalid date format').optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  path: z.string().min(1).max(4096).optional(),
})

export async function GET(request: NextRequest) {
  const params = commitsQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
    sha: request.nextUrl.searchParams.get("sha") ?? undefined,
    since: request.nextUrl.searchParams.get("since") ?? undefined,
    until: request.nextUrl.searchParams.get("until") ?? undefined,
    per_page: request.nextUrl.searchParams.get("per_page") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    path: request.nextUrl.searchParams.get("path") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name, sha, since, until, per_page, page, path } = params.data

  try {
    const token = await getAccessToken(request)

    const commits = await fetchCommits(owner, name, {
      token,
      sha,
      since,
      until,
      perPage: per_page,
      page,
      path,
    })

    return NextResponse.json(commits)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch commits"

    if (message.includes("not found")) {
      return apiError('REPO_NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    return apiError('GITHUB_ERROR', message, 500)
  }
}
