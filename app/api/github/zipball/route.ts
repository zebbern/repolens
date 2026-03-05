import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getAccessToken } from '@/lib/auth/token'
import { apiError } from '@/lib/api/error'
import { GITHUB_NAME_RE } from '@/lib/github/validation'

const zipballSchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  repo: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  ref: z.string().min(1),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_JSON', 'Invalid JSON body', 400)
  }

  const result = zipballSchema.safeParse(body)
  if (!result.success) {
    return apiError(
      'VALIDATION_ERROR',
      result.error.issues[0]?.message ?? 'Validation error',
      422,
    )
  }

  const { owner, repo, ref } = result.data

  try {
    const token = await getAccessToken(request)

    const headers: HeadersInit = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'RepoLens',
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref)}`
    const ghResponse = await fetch(url, {
      headers,
      redirect: 'follow',
    })

    if (!ghResponse.ok) {
      const status = ghResponse.status
      const message =
        status === 404
          ? 'Repository not found or zipball unavailable'
          : status === 403
            ? 'Rate limit exceeded or repository is private'
            : `GitHub API error: ${status}`

      return apiError('GITHUB_ERROR', message, status)
    }

    const arrayBuffer = await ghResponse.arrayBuffer()

    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(arrayBuffer.byteLength),
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Zipball proxy failed'
    return apiError('ZIPBALL_ERROR', message, 500)
  }
}
