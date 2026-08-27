import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { withGitHubCachePolicy } from "@/lib/api/github-cache"
import { apiError } from "@/lib/api/error"
import { applyRateLimit } from "@/lib/api/rate-limit"
import { fetchGitHub } from "@/lib/github/request-signal"

export const runtime = 'edge'

const GITHUB_API_BASE = "https://api.github.com"

export const GET = withGitHubCachePolicy(async function GET(request: NextRequest, token: string | undefined) {
  const rateLimited = applyRateLimit(request, { bucket: '/api/github/rate-limit' })
  if (rateLimited) return rateLimited

  try {
    const hasPAT = !!request.headers.get("X-GitHub-Token")
    const headers: HeadersInit = {
      Accept: "application/vnd.github.v3+json",
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetchGitHub(`${GITHUB_API_BASE}/rate_limit`, { headers, signal: request.signal })

    if (!response.ok) {
      return apiError('RATE_LIMIT_FETCH_ERROR', 'Failed to fetch rate limit', response.status)
    }

    const data = await response.json()
    const core = data.rate ?? data.resources?.core

    const authMethod: 'pat' | 'oauth' | 'none' = hasPAT
      ? 'pat'
      : token
        ? 'oauth'
        : 'none'

    return NextResponse.json({
      limit: core?.limit ?? 0,
      remaining: core?.remaining ?? 0,
      reset: core?.reset ?? 0,
      authenticated: !!token,
      authMethod,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch rate limit"
    return apiError('RATE_LIMIT_ERROR', message, 500)
  }
})
