import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { fetchFileContent } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"

const fileQuerySchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().min(1),
  path: z.string().min(1),
})

export async function GET(request: NextRequest) {
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
