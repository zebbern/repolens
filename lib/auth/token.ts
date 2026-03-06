import { getToken } from "next-auth/jwt"
import type { NextRequest } from "next/server"

/**
 * Extract the GitHub access token from the request.
 *
 * Resolution order:
 *  1. `X-GitHub-Token` header (PAT forwarded by the client)
 *  2. OAuth JWT stored in the NextAuth session cookie
 *  3. `undefined` (unauthenticated)
 *
 * This runs server-side only — the token is never exposed to the client.
 */
export async function getAccessToken(
  request: NextRequest
): Promise<string | undefined> {
  // 1. PAT supplied via header
  const pat = request.headers.get("X-GitHub-Token")?.trim()
  if (pat) return pat

  // 2. OAuth JWT fallback
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  })

  return (token?.accessToken as string) ?? undefined
}
