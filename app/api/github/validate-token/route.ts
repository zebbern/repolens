import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { apiError } from "@/lib/api/error"

const GITHUB_API_BASE = "https://api.github.com"

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("X-GitHub-Token")?.trim()

    if (!token) {
      return NextResponse.json(
        { valid: false, error: "Missing X-GitHub-Token header" },
        { status: 400 }
      )
    }

    if (token.length > 255 || !/^[\w_.-]+$/.test(token)) {
      return NextResponse.json(
        { valid: false, error: "Invalid token format" },
        { status: 400 }
      )
    }

    const response = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return NextResponse.json({
        valid: false,
        error:
          response.status === 401
            ? "Invalid token"
            : `GitHub API returned ${response.status}`,
      })
    }

    const data = await response.json()
    const scopeHeader = response.headers.get("X-OAuth-Scopes") ?? ""
    const scopes = scopeHeader
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)

    return NextResponse.json({
      valid: true,
      login: data.login as string,
      scopes,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Token validation failed"
    return apiError("TOKEN_VALIDATION_ERROR", message, 500)
  }
}
