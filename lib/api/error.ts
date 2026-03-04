import { NextResponse } from 'next/server'

interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: string
  }
}

/**
 * Build a consistent JSON error response for API routes.
 *
 * Shape: `{ error: { code, message, details? } }`
 */
export function apiError(
  code: string,
  message: string,
  status: number,
  details?: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined && { details }),
      },
    },
    { status },
  )
}
