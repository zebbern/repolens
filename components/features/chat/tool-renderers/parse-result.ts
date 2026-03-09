/**
 * Safe JSON parse for tool results. Tool results arrive as JSON strings or
 * raw objects — this helper normalises both cases and returns `null` on
 * failure so renderers can fall back gracefully.
 */
export function parseToolResult<T = Record<string, unknown>>(
  result: unknown,
): T | null {
  if (result === null || result === undefined) return null

  if (typeof result === "string") {
    try {
      return JSON.parse(result) as T
    } catch {
      return null
    }
  }

  if (typeof result === "object") {
    return result as T
  }

  return null
}
