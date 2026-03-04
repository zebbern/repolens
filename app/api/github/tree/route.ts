import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { z } from "zod"
import { getAccessToken } from "@/lib/auth/token"
import { fetchRepoTree } from "@/lib/github/fetcher"
import { apiError } from "@/lib/api/error"

const treeQuerySchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  sha: z.string().min(1).default("HEAD"),
})

export async function GET(request: NextRequest) {
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
    const token = await getAccessToken(request)

    const tree = await fetchRepoTree(owner, name, sha, {
      token,
    })

    return NextResponse.json(tree)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch tree"
    return apiError('GITHUB_ERROR', message, 500)
  }
}
