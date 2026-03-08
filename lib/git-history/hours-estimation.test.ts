import { describe, it, expect } from 'vitest'
import type { GitHubCommit } from '@/types/repository'
import {
  estimateHours,
  computePunchcardData,
  computeHoursOverTime,
  DEFAULT_CONFIG,
} from './hours-estimation'
import type { HoursEstimateConfig, CodingSession } from './hours-estimation'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommit(overrides: Partial<GitHubCommit> = {}): GitHubCommit {
  return {
    sha: 'abc123',
    message: 'fix: something',
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2024-06-10T10:00:00Z',
    committerName: 'Alice',
    committerDate: '2024-06-10T10:00:00Z',
    url: 'https://github.com/x/y/commit/abc123',
    authorLogin: 'alice',
    authorAvatarUrl: 'https://avatars.githubusercontent.com/u/1',
    parents: [{ sha: 'parent1' }],
    ...overrides,
  }
}

function minutesLater(base: string, minutes: number): string {
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString()
}

function daysLater(base: string, days: number): string {
  return new Date(new Date(base).getTime() + days * 86_400_000).toISOString()
}

// ---------------------------------------------------------------------------
// estimateHours
// ---------------------------------------------------------------------------

describe('estimateHours', () => {
  it('returns empty array for empty commits', () => {
    expect(estimateHours([])).toEqual([])
  })

  it('handles a single commit (one session with bonus)', () => {
    const commits = [makeCommit()]
    const result = estimateHours(commits)

    expect(result).toHaveLength(1)
    expect(result[0].commitCount).toBe(1)
    expect(result[0].sessions).toHaveLength(1)
    expect(result[0].sessions[0].durationMinutes).toBe(DEFAULT_CONFIG.firstCommitBonusMinutes)
    expect(result[0].totalHours).toBe(DEFAULT_CONFIG.firstCommitBonusMinutes / 60)
  })

  it('groups closely-spaced commits into a single session', () => {
    const base = '2024-06-10T10:00:00Z'
    const commits = [
      makeCommit({ sha: '1', authorDate: base }),
      makeCommit({ sha: '2', authorDate: minutesLater(base, 30) }),
      makeCommit({ sha: '3', authorDate: minutesLater(base, 60) }),
    ]
    const result = estimateHours(commits)

    expect(result).toHaveLength(1)
    expect(result[0].sessions).toHaveLength(1)
    expect(result[0].sessions[0].commitCount).toBe(3)
    // Duration = 60 min gap + 30 min bonus = 90
    expect(result[0].sessions[0].durationMinutes).toBe(90)
  })

  it('splits commits into separate sessions when gap exceeds threshold', () => {
    const base = '2024-06-10T10:00:00Z'
    const commits = [
      makeCommit({ sha: '1', authorDate: base }),
      makeCommit({ sha: '2', authorDate: minutesLater(base, 30) }),
      makeCommit({ sha: '3', authorDate: minutesLater(base, 200) }), // 200 min gap from base, 170 from #2
    ]
    const result = estimateHours(commits)

    expect(result).toHaveLength(1)
    expect(result[0].sessions).toHaveLength(2)
    expect(result[0].sessions[0].commitCount).toBe(2)
    expect(result[0].sessions[1].commitCount).toBe(1)
  })

  it('excludes merge commits by default', () => {
    const commits = [
      makeCommit({ sha: '1', message: 'Merge branch main into feature' }),
      makeCommit({ sha: '2', message: 'feat: real work' }),
    ]
    const result = estimateHours(commits)

    expect(result).toHaveLength(1)
    expect(result[0].commitCount).toBe(1)
  })

  it('excludes multi-parent merge commits', () => {
    const commits = [
      makeCommit({ sha: '1', parents: [{ sha: 'a' }, { sha: 'b' }] }),
      makeCommit({ sha: '2', message: 'feat: real work' }),
    ]
    const result = estimateHours(commits)

    expect(result[0].commitCount).toBe(1)
  })

  it('includes merge commits when excludeMergeCommits is false', () => {
    const commits = [
      makeCommit({ sha: '1', message: 'Merge pull request #42' }),
      makeCommit({ sha: '2', message: 'feat: real work' }),
    ]
    const result = estimateHours(commits, { excludeMergeCommits: false })

    expect(result[0].commitCount).toBe(2)
  })

  it('excludes bot authors with [bot] suffix', () => {
    const commits = [
      makeCommit({ sha: '1', authorLogin: 'dependabot[bot]', authorName: 'Dependabot' }),
      makeCommit({ sha: '2', authorLogin: 'alice' }),
    ]
    const result = estimateHours(commits)

    expect(result).toHaveLength(1)
    expect(result[0].login).toBe('alice')
  })

  it('does not exclude real developers using GitHub noreply emails', () => {
    const commits = [
      makeCommit({ sha: '1', authorLogin: null, authorEmail: '123+alice@users.noreply.github.com', authorName: 'Alice' }),
      makeCommit({ sha: '2', authorLogin: 'bob' }),
    ]
    const result = estimateHours(commits)

    expect(result).toHaveLength(2)
  })

  it('excludes bot authors by name pattern', () => {
    const commits = [
      makeCommit({ sha: '1', authorLogin: null, authorEmail: 'dep@bot.com', authorName: 'dependabot' }),
      makeCommit({ sha: '2', authorLogin: null, authorEmail: 'ren@bot.com', authorName: 'Renovate Bot' }),
      makeCommit({ sha: '3', authorLogin: null, authorEmail: 'gh@actions.com', authorName: 'GitHub-Actions' }),
      makeCommit({ sha: '4', authorLogin: 'alice' }),
    ]
    const result = estimateHours(commits)

    expect(result).toHaveLength(1)
  })

  it('returns empty when all commits are filtered out', () => {
    const commits = [
      makeCommit({ sha: '1', message: 'Merge branch main' }),
    ]
    const result = estimateHours(commits)
    expect(result).toEqual([])
  })

  it('returns empty when all authors are bots', () => {
    const commits = [
      makeCommit({ sha: '1', authorLogin: 'renovate[bot]', authorName: 'Renovate' }),
    ]
    const result = estimateHours(commits)
    expect(result).toEqual([])
  })

  it('groups commits by authorLogin, falling back to name <email>', () => {
    const base = '2024-06-10T10:00:00Z'
    const commits = [
      makeCommit({ sha: '1', authorLogin: 'alice', authorName: 'Alice', authorDate: base }),
      makeCommit({ sha: '2', authorLogin: null, authorEmail: 'bob@example.com', authorName: 'Bob', authorDate: base }),
      makeCommit({ sha: '3', authorLogin: 'alice', authorName: 'Alice D.', authorDate: minutesLater(base, 30) }),
    ]
    const result = estimateHours(commits)

    expect(result).toHaveLength(2)
    const aliceEstimate = result.find(r => r.login === 'alice')
    expect(aliceEstimate?.commitCount).toBe(2)
  })

  it('populates avatarUrl from first non-null commit in author group', () => {
    const base = '2024-06-10T10:00:00Z'
    const commits = [
      makeCommit({ sha: '1', authorLogin: 'alice', authorAvatarUrl: null, authorDate: base }),
      makeCommit({ sha: '2', authorLogin: 'alice', authorAvatarUrl: 'https://avatar.url', authorDate: minutesLater(base, 10) }),
      makeCommit({ sha: '3', authorLogin: 'alice', authorAvatarUrl: 'https://other.url', authorDate: minutesLater(base, 20) }),
    ]
    const result = estimateHours(commits)

    expect(result).toHaveLength(1)
    expect(result[0].login).toBe('alice')
    expect(result[0].avatarUrl).toBe('https://avatar.url')
  })

  it('caps daily hours to maxDailyHours', () => {
    const base = '2024-06-10T01:00:00Z'
    // Many sessions totaling > 12 hours in one day
    const commits: GitHubCommit[] = []
    for (let i = 0; i < 10; i++) {
      commits.push(makeCommit({
        sha: `s${i}`,
        authorDate: minutesLater(base, i * 90), // each 90 min apart → within session gap
      }))
    }
    // 9 gaps × 90 min = 810 min between first & last + 30 bonus = 840 min = 14 hours
    const result = estimateHours(commits, { maxDailyHours: 12 })

    expect(result[0].totalHours).toBeLessThanOrEqual(12)
  })

  it('computes activeDays correctly', () => {
    const commits = [
      makeCommit({ sha: '1', authorDate: '2024-06-10T10:00:00Z' }),
      makeCommit({ sha: '2', authorDate: '2024-06-10T14:00:00Z' }),
      makeCommit({ sha: '3', authorDate: '2024-06-12T10:00:00Z' }),
    ]
    const result = estimateHours(commits)
    expect(result[0].activeDays).toBe(2)
  })

  it('computes avgHoursPerActiveDay', () => {
    const commits = [
      makeCommit({ sha: '1', authorDate: '2024-06-10T10:00:00Z' }),
      makeCommit({ sha: '2', authorDate: '2024-06-12T10:00:00Z' }),
    ]
    const result = estimateHours(commits)
    // 2 sessions × 30 min bonus each = 60 min = 1 hour, 2 active days
    expect(result[0].avgHoursPerActiveDay).toBe(0.5)
  })

  it('computes mostProductiveDay', () => {
    // Monday: 2024-06-10 (getUTCDay === 1)
    const commits = [
      makeCommit({ sha: '1', authorDate: '2024-06-10T10:00:00Z' }),
      makeCommit({ sha: '2', authorDate: '2024-06-10T11:00:00Z' }),
      // Tuesday: 2024-06-11 (getUTCDay === 2)
      makeCommit({ sha: '3', authorDate: '2024-06-11T10:00:00Z' }),
    ]
    const result = estimateHours(commits)
    // Monday: 60 + 30 = 90 min session; Tuesday: 30 min session
    expect(result[0].mostProductiveDay).toBe('Monday')
  })

  it('computes longestStreakDays', () => {
    const commits = [
      makeCommit({ sha: '1', authorDate: '2024-06-10T10:00:00Z' }),
      makeCommit({ sha: '2', authorDate: '2024-06-11T10:00:00Z' }),
      makeCommit({ sha: '3', authorDate: '2024-06-12T10:00:00Z' }),
      // Gap
      makeCommit({ sha: '4', authorDate: '2024-06-15T10:00:00Z' }),
      makeCommit({ sha: '5', authorDate: '2024-06-16T10:00:00Z' }),
    ]
    const result = estimateHours(commits)
    expect(result[0].longestStreakDays).toBe(3)
  })

  it('sorts results by totalHours descending', () => {
    const base = '2024-06-10T10:00:00Z'
    const commits = [
      // Bob: 1 commit → 30 min
      makeCommit({ sha: '1', authorLogin: 'bob', authorName: 'Bob', authorDate: base }),
      // Alice: 3 commits over 2 hours → more total time
      makeCommit({ sha: '2', authorLogin: 'alice', authorName: 'Alice', authorDate: base }),
      makeCommit({ sha: '3', authorLogin: 'alice', authorName: 'Alice', authorDate: minutesLater(base, 60) }),
      makeCommit({ sha: '4', authorLogin: 'alice', authorName: 'Alice', authorDate: minutesLater(base, 100) }),
    ]
    const result = estimateHours(commits)

    expect(result[0].login).toBe('alice')
    expect(result[1].login).toBe('bob')
  })

  it('respects custom config overrides', () => {
    const base = '2024-06-10T10:00:00Z'
    const commits = [
      makeCommit({ sha: '1', authorDate: base }),
    ]
    const config: Partial<HoursEstimateConfig> = { firstCommitBonusMinutes: 45 }
    const result = estimateHours(commits, config)

    expect(result[0].sessions[0].durationMinutes).toBe(45)
  })

  it('sets linesChanged to 0 on all sessions', () => {
    const commits = [
      makeCommit({ sha: '1' }),
      makeCommit({ sha: '2', authorDate: minutesLater('2024-06-10T10:00:00Z', 30) }),
    ]
    const result = estimateHours(commits)

    for (const session of result[0].sessions) {
      expect(session.linesChanged).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// computePunchcardData
// ---------------------------------------------------------------------------

describe('computePunchcardData', () => {
  it('returns empty array for empty sessions', () => {
    expect(computePunchcardData([])).toEqual([])
  })

  it('buckets sessions by UTC day-of-week and hour', () => {
    const sessions: CodingSession[] = [
      {
        authorLogin: 'alice',
        authorName: 'Alice',
        startTime: '2024-06-10T14:00:00Z', // Monday 14:00 UTC
        endTime: '2024-06-10T15:00:00Z',
        durationMinutes: 90,
        commitCount: 3,
        linesChanged: 0,
      },
      {
        authorLogin: 'alice',
        authorName: 'Alice',
        startTime: '2024-06-17T14:30:00Z', // Also Monday 14:xx UTC
        endTime: '2024-06-17T15:00:00Z',
        durationMinutes: 60,
        commitCount: 2,
        linesChanged: 0,
      },
    ]
    const result = computePunchcardData(sessions)

    expect(result).toHaveLength(1) // Both land in Monday-14
    expect(result[0].dayOfWeek).toBe(1) // Monday
    expect(result[0].hour).toBe(14)
    expect(result[0].hours).toBe(2.5) // 90 + 60 = 150 min = 2.5h
  })
})

// ---------------------------------------------------------------------------
// computeHoursOverTime
// ---------------------------------------------------------------------------

describe('computeHoursOverTime', () => {
  const sessions: CodingSession[] = [
    {
      authorLogin: 'alice',
      authorName: 'Alice',
      startTime: '2024-06-10T10:00:00Z',
      endTime: '2024-06-10T11:00:00Z',
      durationMinutes: 60,
      commitCount: 2,
      linesChanged: 0,
    },
    {
      authorLogin: 'alice',
      authorName: 'Alice',
      startTime: '2024-06-10T15:00:00Z',
      endTime: '2024-06-10T16:00:00Z',
      durationMinutes: 30,
      commitCount: 1,
      linesChanged: 0,
    },
    {
      authorLogin: 'bob',
      authorName: 'Bob',
      startTime: '2024-06-10T12:00:00Z',
      endTime: '2024-06-10T13:00:00Z',
      durationMinutes: 45,
      commitCount: 2,
      linesChanged: 0,
    },
  ]

  it('returns empty for empty sessions', () => {
    expect(computeHoursOverTime([], 'day')).toEqual([])
  })

  it('aggregates by day per author', () => {
    const result = computeHoursOverTime(sessions, 'day')

    expect(result).toHaveLength(2) // Alice on 6/10, Bob on 6/10
    const alice = result.find(r => r.author === 'Alice')!
    expect(alice.date).toBe('2024-06-10')
    expect(alice.hours).toBe(1.5) // 60 + 30 = 90 min
  })

  it('aggregates by week (ISO Monday start)', () => {
    const result = computeHoursOverTime(sessions, 'week')
    // 2024-06-10 is a Monday, so week key = 2024-06-10
    expect(result[0].date).toBe('2024-06-10')
  })

  it('aggregates by month', () => {
    const result = computeHoursOverTime(sessions, 'month')
    expect(result.every(r => r.date === '2024-06')).toBe(true)
  })

  it('sorts results by date ascending', () => {
    const multiDay: CodingSession[] = [
      { ...sessions[0], startTime: '2024-06-12T10:00:00Z' },
      { ...sessions[0], startTime: '2024-06-10T10:00:00Z' },
    ]
    const result = computeHoursOverTime(multiDay, 'day')
    expect(result[0].date).toBe('2024-06-10')
    expect(result[1].date).toBe('2024-06-12')
  })
})
