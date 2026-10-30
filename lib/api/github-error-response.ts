import type { NextResponse } from 'next/server'

import { apiError } from './error'
import {
  GITHUB_ERROR_RESPONSES,
  GitHubError,
  isAbortError,
  isGitHubError,
} from '@/lib/github/errors'

interface GitHubErrorResponseOptions {
  /** Log prefix, for example `tags`. */
  tag: string
  /** Generic 500 message for failures that are not a GitHubError. */
  fallback: string
  /** Code for not_found; routes keep their historical REPO_NOT_FOUND or NOT_FOUND. */
  notFoundCode?: string
}

/**
 * Turn a failure from lib/github/fetcher.ts into the route's error response.
 *
 * - A client abort is rethrown, never logged or reported as a GitHub error.
 * - A GitHubError maps through GITHUB_ERROR_RESPONSES to its status, code and
 *   table message; GitHub's own text is only logged.
 * - Anything else is logged and becomes a generic 500 with `fallback`.
 */
export function gitHubErrorResponse(
  request: Request,
  error: unknown,
  options: GitHubErrorResponseOptions,
): NextResponse {
  if (request.signal?.aborted) throw request.signal.reason ?? error
  if (isAbortError(error)) throw error

  // A deadline that fired while reading a body, after the fetcher returned.
  const failure = !isGitHubError(error) && (error as { name?: unknown } | null)?.name === 'TimeoutError'
    ? new GitHubError('timeout', { resource: 'github', upstreamMessage: String((error as { message?: unknown }).message) })
    : error

  if (!isGitHubError(failure)) {
    const message = failure instanceof Error ? failure.message : String(failure)
    console.error(`[${options.tag}] GitHub API error:`, message)
    return apiError('GITHUB_ERROR', options.fallback, 500)
  }

  const { status, code } = GITHUB_ERROR_RESPONSES[failure.kind]
  const detail = `${failure.kind} (GitHub ${failure.upstreamStatus ?? 'no response'}): ${failure.upstreamMessage ?? 'no detail'}`
  if (status >= 500) {
    console.error(`[${options.tag}] GitHub API error:`, detail)
  } else {
    console.warn(`[${options.tag}] GitHub API error:`, detail)
  }

  const response = apiError(
    failure.kind === 'not_found' ? options.notFoundCode ?? code : code,
    failure.message,
    status,
  )
  if (failure.kind === 'rate_limited' && failure.retryAfter !== undefined) {
    response.headers.set('Retry-After', String(failure.retryAfter))
  }
  return response
}
