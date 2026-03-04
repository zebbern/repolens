import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { fetchRepoMetadata } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"

const repoQuerySchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
})

export async function GET(request: NextRequest) {
  const params = repoQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name', 400)
  }

  const { owner, name } = params.data

  try {
    const token = await getAccessToken(request)

    const repo = await fetchRepoMetadata(owner, name, {
      token,
    })

    return NextResponse.json(repo)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch repository"

    if (message.includes("not found")) {
      return apiError('REPO_NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    return apiError('GITHUB_ERROR', message, 500)
  }
}
