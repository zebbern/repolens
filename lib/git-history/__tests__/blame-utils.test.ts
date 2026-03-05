import { describe, it, expect } from 'vitest'
import { expandBlameRanges, computeBlameStats, getBlameForLine } from '../blame-utils'
import type { BlameRange, BlameCommit } from '@/types/git-history'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommit(overrides: Partial<BlameCommit> = {}): BlameCommit {
  return {
    oid: 'abc1234',
    abbreviatedOid: 'abc1234',
    message: 'fix: something',
    messageHeadline: 'fix: something',
    committedDate: '2024-06-15T10:00:00Z',
    url: 'https://github.com/owner/repo/commit/abc1234',
    author: {
      name: 'Alice',
      email: 'alice@example.com',
      date: '2024-06-15T10:00:00Z',
      user: { login: 'alice', avatarUrl: 'https://avatar.test/alice' },
    },
    ...overrides,
  }
}

function makeRange(overrides: Partial<BlameRange> = {}): BlameRange {
  return {
    startingLine: 1,
    endingLine: 5,
    age: 3,
    commit: makeCommit(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// expandBlameRanges
// ---------------------------------------------------------------------------

describe('expandBlameRanges', () => {
  it('returns an empty array for empty input', () => {
    expect(expandBlameRanges([])).toEqual([])
  })

  it('expands a single range into per-line BlameLineInfo entries', () => {
    const lines = expandBlameRanges([makeRange({ startingLine: 3, endingLine: 5 })])

    expect(lines).toHaveLength(3)
    expect(lines.map(l => l.lineNumber)).toEqual([3, 4, 5])
  })

  it('marks the first line of each range with isRangeStart', () => {
    const lines = expandBlameRanges([makeRange({ startingLine: 1, endingLine: 3 })])

    expect(lines[0].isRangeStart).toBe(true)
    expect(lines[1].isRangeStart).toBe(false)
    expect(lines[2].isRangeStart).toBe(false)
  })

  it('sorts results by lineNumber ascending', () => {
    const lines = expandBlameRanges([
      makeRange({ startingLine: 10, endingLine: 12 }),
      makeRange({ startingLine: 1, endingLine: 3 }),
    ])

    expect(lines.map(l => l.lineNumber)).toEqual([1, 2, 3, 10, 11, 12])
  })
})

// ---------------------------------------------------------------------------
// computeBlameStats
// ---------------------------------------------------------------------------

describe('computeBlameStats', () => {
  it('returns an empty array for empty input', () => {
    expect(computeBlameStats([])).toEqual([])
  })

  it('groups by author email and calculates percentages', () => {
    const ranges: BlameRange[] = [
      makeRange({
        startingLine: 1,
        endingLine: 7,
        commit: makeCommit({
          author: { name: 'Alice', email: 'alice@example.com', date: null, user: null },
        }),
      }),
      makeRange({
        startingLine: 8,
        endingLine: 10,
        commit: makeCommit({
          author: { name: 'Bob', email: 'bob@example.com', date: null, user: null },
        }),
      }),
    ]

    const stats = computeBlameStats(ranges)

    expect(stats).toHaveLength(2)
    // Alice has 7/10 = 70%, Bob has 3/10 = 30%
    expect(stats[0].name).toBe('Alice')
    expect(stats[0].lineCount).toBe(7)
    expect(stats[0].percentage).toBe(70)
    expect(stats[1].name).toBe('Bob')
    expect(stats[1].lineCount).toBe(3)
    expect(stats[1].percentage).toBe(30)
  })

  it('handles null author gracefully', () => {
    const ranges: BlameRange[] = [
      makeRange({
        startingLine: 1,
        endingLine: 5,
        commit: makeCommit({ author: null }),
      }),
    ]

    const stats = computeBlameStats(ranges)

    expect(stats).toHaveLength(1)
    expect(stats[0].name).toBe('Unknown')
    expect(stats[0].email).toBe('unknown')
  })

  it('sorts by lineCount descending', () => {
    const ranges: BlameRange[] = [
      makeRange({
        startingLine: 1,
        endingLine: 2,
        commit: makeCommit({
          author: { name: 'Small', email: 'small@test.com', date: null, user: null },
        }),
      }),
      makeRange({
        startingLine: 3,
        endingLine: 10,
        commit: makeCommit({
          author: { name: 'Big', email: 'big@test.com', date: null, user: null },
        }),
      }),
    ]

    const stats = computeBlameStats(ranges)
    expect(stats[0].name).toBe('Big')
    expect(stats[1].name).toBe('Small')
  })
})

// ---------------------------------------------------------------------------
// getBlameForLine
// ---------------------------------------------------------------------------

describe('getBlameForLine', () => {
  const ranges: BlameRange[] = [
    makeRange({ startingLine: 1, endingLine: 5 }),
    makeRange({ startingLine: 10, endingLine: 15, commit: makeCommit({ oid: 'def5678' }) }),
    makeRange({ startingLine: 20, endingLine: 25, commit: makeCommit({ oid: 'ghi9012' }) }),
  ]

  it('returns null for empty input', () => {
    expect(getBlameForLine([], 3)).toBeNull()
  })

  it('finds the correct range for a covered line', () => {
    const result = getBlameForLine(ranges, 12)
    expect(result).not.toBeNull()
    expect(result!.commit.oid).toBe('def5678')
  })

  it('returns null for an uncovered line (gap between ranges)', () => {
    expect(getBlameForLine(ranges, 7)).toBeNull()
  })

  it('handles the first line of the first range', () => {
    const result = getBlameForLine(ranges, 1)
    expect(result).not.toBeNull()
    expect(result!.startingLine).toBe(1)
  })

  it('handles the last line of the last range', () => {
    const result = getBlameForLine(ranges, 25)
    expect(result).not.toBeNull()
    expect(result!.commit.oid).toBe('ghi9012')
  })
})
