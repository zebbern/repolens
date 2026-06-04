import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * First path segments that must NOT be treated as `:owner/:repo` routes.
 * Checked case-insensitively against the first segment of the pathname.
 */
const RESERVED_SEGMENTS = new Set([
    'api',
    '_next',
    'compare',
    'favicon.ico',
    'site.webmanifest',
    'robots.txt',
    'public',
    'wasm',
])

/** Only allow valid GitHub username/repo characters: alphanumeric, hyphens, dots, underscores. */
const GITHUB_NAME_RE = /^[\w][\w.-]*$/

function addSecurityHeaders(response: NextResponse): void {
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.set('X-XSS-Protection', '1; mode=block')
}

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Strip trailing slash for consistent segment parsing (but not for "/")
    const normalizedPath = pathname.length > 1 && pathname.endsWith('/')
        ? pathname.slice(0, -1)
        : pathname

    // Split into non-empty segments: "/owner/repo" → ["owner", "repo"]
    const segments = normalizedPath.split('/').filter(Boolean)

    // Path-based repo rewrite. Matches GitHub's repo URL grammar:
    //   /owner/repo                          → repo root
    //   /owner/repo/tree/<branch>[/subpath]  → branch / directory
    //   /owner/repo/blob/<branch>/<path>     → file
    // The first segment must not be reserved, and owner/repo must be valid names.
    const isRepoRoot = segments.length === 2
    const isTreeOrBlob = segments.length > 2 && (segments[2] === 'tree' || segments[2] === 'blob')
    if (
        (isRepoRoot || isTreeOrBlob)
        && !RESERVED_SEGMENTS.has(segments[0].toLowerCase())
        && GITHUB_NAME_RE.test(segments[0])
        && GITHUB_NAME_RE.test(segments[1])
    ) {
        const rewriteUrl = new URL('/', request.url)
        // join() preserves any /tree/branch/subpath so the client can parse it
        rewriteUrl.searchParams.set('repo', `https://github.com/${segments.join('/')}`)

        // Preserve any additional query params (e.g. ?view=docs)
        request.nextUrl.searchParams.forEach((value, key) => {
            if (key !== 'repo') {
                rewriteUrl.searchParams.set(key, value)
            }
        })

        const response = NextResponse.rewrite(rewriteUrl)
        addSecurityHeaders(response)
        return response
    }

    // Default: pass through with security headers
    const response = NextResponse.next()
    addSecurityHeaders(response)
    // Note: CSP is configured in next.config.mjs to avoid conflicts
    return response
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api/auth (NextAuth routes)
         * - api (other API routes — handled by route handlers)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public folder
         */
        '/((?!api/auth|api|_next/static|_next/image|favicon.ico|public/).*)',
    ],
}
