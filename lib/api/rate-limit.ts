import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { apiError } from './error'

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimitOptions {
  limit?: number
  windowMs?: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

const DEFAULT_LIMIT = 60
const DEFAULT_WINDOW_MS = 60_000

/**
 * In-memory rate limit store, keyed by IP address.
 *
 * NOTE: In serverless environments (e.g. Vercel), this state resets on cold
 * starts. This provides best-effort protection, not a hard guarantee.
 */
const store = new Map<string, RateLimitEntry>()

const CLEANUP_INTERVAL_MS = 60_000
let lastCleanup = Date.now()

function cleanupExpiredEntries(): void {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key)
    }
  }
}

/**
 * Check whether the given IP is within its rate limit window.
 */
export function rateLimit(
  ip: string,
  options?: RateLimitOptions,
): RateLimitResult {
  const limit = options?.limit ?? DEFAULT_LIMIT
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS
  const now = Date.now()

  cleanupExpiredEntries()

  const existing = store.get(ip)

  // First request or window expired — start a new window
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs
    store.set(ip, { count: 1, resetAt })
    return { allowed: true, remaining: limit - 1, resetAt }
  }

  // Within window — increment
  existing.count++

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt }
  }

  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  }
}

/**
 * Extract client IP from request headers.
 * Uses first IP from x-forwarded-for header, falls back to x-real-ip,
 * then to 127.0.0.1.
 * Note: Sufficient when deployed behind a trusted reverse proxy (Vercel, Cloudflare).
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  return '127.0.0.1'
}

/**
 * Apply rate limiting to a request. Returns a 429 response if the limit is
 * exceeded, or null if the request is allowed.
 */
export function applyRateLimit(
  request: NextRequest,
  options?: RateLimitOptions,
): NextResponse | null {
  const ip = getClientIp(request)
  const result = rateLimit(ip, options)

  if (!result.allowed) {
    const retryAfterSec = Math.ceil((result.resetAt - Date.now()) / 1000)
    const response = apiError('RATE_LIMITED', 'Too many requests', 429)
    response.headers.set('Retry-After', String(Math.max(retryAfterSec, 1)))
    response.headers.set('X-RateLimit-Limit', String(options?.limit ?? DEFAULT_LIMIT))
    response.headers.set('X-RateLimit-Remaining', '0')
    response.headers.set('X-RateLimit-Reset', String(result.resetAt))
    return response
  }

  return null
}

/** Exposed for testing — clears the internal rate limit store. */
export function _resetStore(): void {
  store.clear()
}
