import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { getAccessToken } from "@/lib/auth/token"
import { fetchCommitDetail } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"

const GITHUB_NAME_RE = /^[\w][\w.-]*$/
const SHA_RE = /^[a-f0-9]{4,40}$/i

const commitDetailSchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sha: string }> },
) {
  const { sha } = await params

  if (!SHA_RE.test(sha)) {
    return apiError('VALIDATION_ERROR', 'Invalid commit SHA format', 400)
  }

  const query = commitDetailSchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
  })

  if (!query.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name } = query.data

  try {
    const token = await getAccessToken(request)

    const data = await fetchCommitDetail(owner, name, sha, { token })

    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch commit detail"

    if (message.includes("not found")) {
      return apiError('NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    console.error('[commit-detail] GitHub API error:', message)
    return apiError('GITHUB_ERROR', 'Failed to fetch commit detail', 500)
  }
}
