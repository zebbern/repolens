import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { fetchCompare } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"

const compareQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  base: z.string().min(1).max(256),
  head: z.string().min(1).max(256),
})

export async function GET(request: NextRequest) {
  const params = compareQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
    base: request.nextUrl.searchParams.get("base") ?? undefined,
    head: request.nextUrl.searchParams.get("head") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name, base, head', 400)
  }

  const { owner, name, base, head } = params.data

  try {
    const token = await getAccessToken(request)

    const comparison = await fetchCompare(owner, name, base, head, {
      token,
    })

    return NextResponse.json(comparison)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch comparison"

    if (message.includes("not found")) {
      return apiError('REPO_NOT_FOUND', message, 404)
    }
    if (message.includes("Rate limit")) {
      return apiError('RATE_LIMIT', message, 403)
    }
    if (message.includes("Invalid request")) {
      return apiError('VALIDATION_ERROR', message, 422)
    }

    return apiError('GITHUB_ERROR', message, 500)
  }
}
