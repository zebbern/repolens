import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getAccessToken } from '@/lib/auth/token'

const GITHUB_NAME_RE = /^[\w][\w.-]*$/

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
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  const result = zipballSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0]?.message ?? 'Validation error' },
      { status: 422 },
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

      return NextResponse.json({ error: message }, { status })
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
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
