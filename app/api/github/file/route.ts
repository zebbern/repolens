import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { fetchFileContent } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"
import { GITHUB_NAME_RE } from "@/lib/github/validation"
import { applyRateLimit } from "@/lib/api/rate-limit"

const fileQuerySchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  name: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  branch: z.string().min(1).refine(s => !s.includes('..'), 'Invalid branch name'),
  path: z.string().min(1).refine(s => !s.includes('..'), 'Invalid path'),
})

export async function GET(request: NextRequest) {
  const rateLimited = applyRateLimit(request, { limit: 500, windowMs: 60_000 })
  if (rateLimited) return rateLimited

  const params = fileQuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get("owner") ?? undefined,
    name: request.nextUrl.searchParams.get("name") ?? undefined,
    branch: request.nextUrl.searchParams.get("branch") ?? undefined,
    path: request.nextUrl.searchParams.get("path") ?? undefined,
  })

  if (!params.success) {
    return apiError('VALIDATION_ERROR', 'Missing required parameters: owner, name, branch, path', 400)
  }

  const { owner, name, branch, path } = params.data

  try {
    const token = await getAccessToken(request)

    const content = await fetchFileContent(owner, name, branch, path, {
      token,
    })

    return NextResponse.json({ content })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch file"
    return apiError('GITHUB_ERROR', message, 500)
  }
}
