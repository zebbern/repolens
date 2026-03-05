import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { fetchTags } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"

const tagsQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
})

export async function GET(request: NextRequest) {
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
    const token = await getAccessToken(request)

    const tags = await fetchTags(owner, name, {
      token,
      perPage: per_page,
      page,
    })

    return NextResponse.json(tags)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch tags"

    if (message.includes("not found")) {
      return apiError('REPO_NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }

    return apiError('GITHUB_ERROR', message, 500)
  }
}
