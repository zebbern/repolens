import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getAccessToken } from '@/lib/auth/token'
import { apiError } from '@/lib/api/error'
import { GITHUB_NAME_RE } from '@/lib/github/validation'
import { applyRateLimit } from '@/lib/api/rate-limit'

export const runtime = 'edge'

const zipballSchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  repo: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  ref: z.string().min(1).max(256),
})

export async function POST(request: NextRequest): Promise<Response> {
  const rateLimited = applyRateLimit(request)
  if (rateLimited) return rateLimited

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
      signal: AbortSignal.timeout(120_000),
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

    const responseHeaders = new Headers({ 'Content-Type': 'application/zip' })
    const contentLength = ghResponse.headers.get('Content-Length')
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength)
    }

    return new Response(ghResponse.body, { headers: responseHeaders })
  } catch (error) {
    console.error('Zipball proxy error:', error)
    return apiError('ZIPBALL_ERROR', 'Zipball proxy failed', 500)
  }
}
