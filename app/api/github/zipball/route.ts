import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getAccessToken } from '@/lib/auth/token'
import { apiError } from '@/lib/api/error'
import { readBoundedJsonBody } from '@/lib/api/json-body'
import { GITHUB_NAME_RE } from '@/lib/github/validation'
import { applyRateLimit } from '@/lib/api/rate-limit'

export const runtime = 'edge'
const MAX_ZIPBALL_REQUEST_BODY_BYTES = 4 * 1024
const MAX_ZIPBALL_BYTES = 50_000_000

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  const listeners = new Map<AbortSignal, () => void>()

  const abortFrom = (signal: AbortSignal) => {
    for (const [source, listener] of listeners) {
      source.removeEventListener('abort', listener)
    }
    listeners.clear()
    controller.abort(signal.reason)
  }

  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal)
      break
    }
    const listener = () => abortFrom(signal)
    listeners.set(signal, listener)
    signal.addEventListener('abort', listener, { once: true })
  }

  return controller.signal
}

const zipballSchema = z.object({
  owner: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid owner name'),
  repo: z.string().min(1).regex(GITHUB_NAME_RE, 'Invalid repo name'),
  ref: z.string().min(1).max(256),
})

export async function POST(request: NextRequest): Promise<Response> {
  const rateLimited = applyRateLimit(request, {
    bucket: '/api/github/zipball',
    limit: 5,
    windowMs: 60_000,
  })
  if (rateLimited) return rateLimited

  const body = await readBoundedJsonBody(request, MAX_ZIPBALL_REQUEST_BODY_BYTES)
  if (!body.success) return body.response

  const result = zipballSchema.safeParse(body.data)
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
      signal: combineAbortSignals([request.signal, AbortSignal.timeout(120_000)]),
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

    const declaredLength = Number(ghResponse.headers.get('Content-Length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ZIPBALL_BYTES) {
      await ghResponse.body?.cancel()
      return apiError('RESPONSE_TOO_LARGE', 'Zipball exceeds the maximum response size', 413)
    }

    const upstream = ghResponse.body
    if (!upstream) return apiError('ZIPBALL_ERROR', 'Zipball response had no body', 502)
    const reader = upstream.getReader()
    let bytesRead = 0
    const boundedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            return
          }
          bytesRead += value.byteLength
          if (bytesRead > MAX_ZIPBALL_BYTES) {
            await reader.cancel()
            controller.error(new Error('Zipball exceeds maximum response size'))
            return
          }
          controller.enqueue(value)
        } catch (error) {
          controller.error(error)
        }
      },
      async cancel(reason) {
        await reader.cancel(reason)
      },
    })

    const responseHeaders = new Headers({ 'Content-Type': 'application/zip' })
    const contentLength = ghResponse.headers.get('Content-Length')
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength)
    }

    return new Response(boundedBody, { headers: responseHeaders })
  } catch (error) {
    console.error('Zipball proxy error:', error)
    return apiError('ZIPBALL_ERROR', 'Zipball proxy failed', 500)
  }
}
