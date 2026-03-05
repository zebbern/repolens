import type { BlameRange } from '@/types/git-history'
import type { BlameLineInfo, BlameAuthorStats } from './types'

/**
 * Expand blame ranges into a flat per-line array for the blame gutter.
 * Line numbers are 1-based. Result is sorted ascending by lineNumber.
 */
export function expandBlameRanges(ranges: BlameRange[]): BlameLineInfo[] {
  if (ranges.length === 0) return []

  const lines: BlameLineInfo[] = []

  for (const range of ranges) {
    for (let line = range.startingLine; line <= range.endingLine; line++) {
      lines.push({
        lineNumber: line,
        commit: range.commit,
        age: range.age,
        isRangeStart: line === range.startingLine,
      })
    }
  }

  return lines.sort((a, b) => a.lineNumber - b.lineNumber)
}

/**
 * Compute per-author contribution stats from blame ranges.
 * Authors are keyed by email. Returns sorted descending by lineCount.
 */
export function computeBlameStats(ranges: BlameRange[]): BlameAuthorStats[] {
  if (ranges.length === 0) return []

  const statsMap = new Map<
    string,
    { name: string; email: string; login: string | null; avatarUrl: string | null; lineCount: number }
  >()

  let totalLines = 0

  for (const range of ranges) {
    const lineCount = range.endingLine - range.startingLine + 1
    totalLines += lineCount

    const author = range.commit.author
    const name = author?.name ?? 'Unknown'
    const email = author?.email ?? 'unknown'
    const user = author?.user ?? null
    const existing = statsMap.get(email)

    if (existing) {
      existing.lineCount += lineCount
      // Prefer non-null user data from any range
      if (!existing.login && user) {
        existing.login = user.login
        existing.avatarUrl = user.avatarUrl
      }
    } else {
      statsMap.set(email, {
        name,
        email,
        login: user?.login ?? null,
        avatarUrl: user?.avatarUrl ?? null,
        lineCount,
      })
    }
  }

  if (totalLines === 0) return []

  return Array.from(statsMap.values())
    .map((entry) => ({
      ...entry,
      percentage: Math.round((entry.lineCount / totalLines) * 1000) / 10,
    }))
    .sort((a, b) => b.lineCount - a.lineCount)
}

/**
 * Get the blame range that covers a specific line number.
 * Returns null if no range contains the line.
 * Uses binary search since ranges are ordered and non-overlapping.
 */
export function getBlameForLine(
  ranges: BlameRange[],
  lineNumber: number,
): BlameRange | null {
  if (ranges.length === 0) return null

  let low = 0
  let high = ranges.length - 1

  while (low <= high) {
    const mid = (low + high) >>> 1
    const range = ranges[mid]

    if (lineNumber < range.startingLine) {
      high = mid - 1
    } else if (lineNumber > range.endingLine) {
      low = mid + 1
    } else {
      return range
    }
  }

  return null
}
