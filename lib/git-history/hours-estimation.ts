import type { GitHubCommit } from '@/types/repository'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HoursEstimateConfig {
  maxSessionGapMinutes: number
  firstCommitBonusMinutes: number
  excludeMergeCommits: boolean
  maxDailyHours: number
}

export interface CodingSession {
  authorLogin: string | null
  authorName: string
  startTime: string
  endTime: string
  durationMinutes: number
  commitCount: number
  linesChanged: number
}

export interface AuthorHoursEstimate {
  author: string
  login: string | null
  avatarUrl: string | null
  totalHours: number
  sessions: CodingSession[]
  commitCount: number
  activeDays: number
  avgHoursPerActiveDay: number
  mostProductiveDay: string
  longestStreakDays: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: HoursEstimateConfig = {
  maxSessionGapMinutes: 120,
  firstCommitBonusMinutes: 30,
  excludeMergeCommits: true,
  maxDailyHours: 12,
}

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday',
] as const

const BOT_NAME_PATTERNS = ['dependabot', 'renovate', 'github-actions']

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

export function estimateHours(
  commits: GitHubCommit[],
  config?: Partial<HoursEstimateConfig>,
): AuthorHoursEstimate[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  if (commits.length === 0) return []

  let filtered = cfg.excludeMergeCommits
    ? commits.filter(c => !isMergeCommit(c))
    : [...commits]

  filtered = filtered.filter(c => !isBotAuthor(c))

  if (filtered.length === 0) return []

  const authorGroups = groupByAuthor(filtered)
  const results: AuthorHoursEstimate[] = []

  for (const [, authorCommits] of authorGroups) {
    const sorted = [...authorCommits].sort(
      (a, b) => new Date(a.authorDate).getTime() - new Date(b.authorDate).getTime(),
    )

    const sessions = buildSessions(sorted, cfg)
    capDailyHours(sessions, cfg.maxDailyHours)

    const totalHours = sessions.reduce((sum, s) => sum + s.durationMinutes, 0) / 60

    // Prefer non-null login/avatar from earliest commit that has them
    let login: string | null = null
    let avatarUrl: string | null = null
    for (const c of sorted) {
      if (!login && c.authorLogin) login = c.authorLogin
      if (!avatarUrl && c.authorAvatarUrl) avatarUrl = c.authorAvatarUrl
      if (login && avatarUrl) break
    }

    const activeDays = countActiveDays(sessions)

    results.push({
      author: sorted[0].authorName,
      login,
      avatarUrl,
      totalHours,
      sessions,
      commitCount: sorted.length,
      activeDays,
      avgHoursPerActiveDay: activeDays > 0 ? totalHours / activeDays : 0,
      mostProductiveDay: findMostProductiveDay(sessions),
      longestStreakDays: computeLongestStreak(sessions),
    })
  }

  return results.sort((a, b) => b.totalHours - a.totalHours)
}

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------

/** Aggregate coding hours into day-of-week × hour-of-day buckets for a punchcard chart. */
export function computePunchcardData(
  sessions: CodingSession[],
): { dayOfWeek: number; hour: number; hours: number }[] {
  const buckets = new Map<string, { dayOfWeek: number; hour: number; hours: number }>()

  for (const session of sessions) {
    const date = new Date(session.startTime)
    const dayOfWeek = date.getUTCDay()
    const hour = date.getUTCHours()
    const key = `${dayOfWeek}-${hour}`

    const existing = buckets.get(key)
    if (existing) {
      existing.hours += session.durationMinutes / 60
    } else {
      buckets.set(key, { dayOfWeek, hour, hours: session.durationMinutes / 60 })
    }
  }

  return Array.from(buckets.values())
}

/** Aggregate coding hours over time at the given granularity, broken out per author. */
export function computeHoursOverTime(
  sessions: CodingSession[],
  granularity: 'day' | 'week' | 'month',
): { date: string; hours: number; author: string }[] {
  const buckets = new Map<string, { date: string; hours: number; author: string }>()

  for (const session of sessions) {
    const dateKey = granularityKey(session.startTime, granularity)
    const mapKey = `${dateKey}|${session.authorName}`

    const existing = buckets.get(mapKey)
    if (existing) {
      existing.hours += session.durationMinutes / 60
    } else {
      buckets.set(mapKey, {
        date: dateKey,
        hours: session.durationMinutes / 60,
        author: session.authorName,
      })
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isMergeCommit(commit: GitHubCommit): boolean {
  return commit.message.startsWith('Merge ') || commit.parents.length > 1
}

function isBotAuthor(commit: GitHubCommit): boolean {
  if (commit.authorLogin?.endsWith('[bot]')) return true
  const nameLower = commit.authorName.toLowerCase()
  return BOT_NAME_PATTERNS.some(p => nameLower.includes(p))
}

function groupByAuthor(commits: GitHubCommit[]): Map<string, GitHubCommit[]> {
  const groups = new Map<string, GitHubCommit[]>()
  for (const commit of commits) {
    const key = commit.authorLogin ?? `${commit.authorName} <${commit.authorEmail}>`
    const group = groups.get(key)
    if (group) {
      group.push(commit)
    } else {
      groups.set(key, [commit])
    }
  }
  return groups
}

function buildSessions(
  sortedCommits: GitHubCommit[],
  cfg: HoursEstimateConfig,
): CodingSession[] {
  if (sortedCommits.length === 0) return []

  const sessions: CodingSession[] = []
  let sessionStartIdx = 0
  let sessionEnd = new Date(sortedCommits[0].authorDate)

  for (let i = 1; i < sortedCommits.length; i++) {
    const currentTime = new Date(sortedCommits[i].authorDate)
    const gapMinutes = (currentTime.getTime() - sessionEnd.getTime()) / (1000 * 60)

    if (gapMinutes < cfg.maxSessionGapMinutes) {
      sessionEnd = currentTime
    } else {
      // Close current session
      const sessionStart = new Date(sortedCommits[sessionStartIdx].authorDate)
      const rawMinutes =
        (sessionEnd.getTime() - sessionStart.getTime()) / (1000 * 60) +
        cfg.firstCommitBonusMinutes

      sessions.push({
        authorLogin: sortedCommits[sessionStartIdx].authorLogin,
        authorName: sortedCommits[sessionStartIdx].authorName,
        startTime: sessionStart.toISOString(),
        endTime: sessionEnd.toISOString(),
        durationMinutes: rawMinutes,
        commitCount: i - sessionStartIdx,
        linesChanged: 0,
      })

      sessionStartIdx = i
      sessionEnd = currentTime
    }
  }

  // Close final session
  const sessionStart = new Date(sortedCommits[sessionStartIdx].authorDate)
  const rawMinutes =
    (sessionEnd.getTime() - sessionStart.getTime()) / (1000 * 60) +
    cfg.firstCommitBonusMinutes

  sessions.push({
    authorLogin: sortedCommits[sessionStartIdx].authorLogin,
    authorName: sortedCommits[sessionStartIdx].authorName,
    startTime: sessionStart.toISOString(),
    endTime: sessionEnd.toISOString(),
    durationMinutes: rawMinutes,
    commitCount: sortedCommits.length - sessionStartIdx,
    linesChanged: 0,
  })

  return sessions
}

/** Scale session durations so no single calendar day exceeds maxDailyHours. */
function capDailyHours(sessions: CodingSession[], maxDailyHours: number): void {
  const dayMap = new Map<string, CodingSession[]>()
  for (const session of sessions) {
    const dayKey = session.startTime.slice(0, 10)
    const group = dayMap.get(dayKey)
    if (group) {
      group.push(session)
    } else {
      dayMap.set(dayKey, [session])
    }
  }

  const maxMinutes = maxDailyHours * 60
  for (const [, daySessions] of dayMap) {
    const totalMinutes = daySessions.reduce((sum, s) => sum + s.durationMinutes, 0)
    if (totalMinutes > maxMinutes) {
      const scale = maxMinutes / totalMinutes
      for (const s of daySessions) {
        s.durationMinutes *= scale
      }
    }
  }
}

function countActiveDays(sessions: CodingSession[]): number {
  const days = new Set<string>()
  for (const s of sessions) {
    days.add(s.startTime.slice(0, 10))
  }
  return days.size
}

function findMostProductiveDay(sessions: CodingSession[]): string {
  if (sessions.length === 0) return DAY_NAMES[1] // Monday default

  const hoursPerDay = new Array<number>(7).fill(0)
  for (const s of sessions) {
    const dow = new Date(s.startTime).getUTCDay()
    hoursPerDay[dow] += s.durationMinutes / 60
  }

  let maxIdx = 0
  for (let i = 1; i < 7; i++) {
    if (hoursPerDay[i] > hoursPerDay[maxIdx]) maxIdx = i
  }
  return DAY_NAMES[maxIdx]
}

function computeLongestStreak(sessions: CodingSession[]): number {
  if (sessions.length === 0) return 0

  const days = new Set<string>()
  for (const s of sessions) {
    days.add(s.startTime.slice(0, 10))
  }

  const sorted = Array.from(days).sort()
  let longest = 1
  let current = 1

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diffMs = curr.getTime() - prev.getTime()

    if (Math.round(diffMs / (1000 * 60 * 60 * 24)) === 1) {
      current++
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }

  return longest
}

function granularityKey(
  isoDate: string,
  granularity: 'day' | 'week' | 'month',
): string {
  switch (granularity) {
    case 'day':
      return isoDate.slice(0, 10)
    case 'week': {
      const date = new Date(isoDate)
      const dow = date.getUTCDay()
      const offset = dow === 0 ? -6 : 1 - dow // shift to Monday
      const monday = new Date(date)
      monday.setUTCDate(date.getUTCDate() + offset)
      return monday.toISOString().slice(0, 10)
    }
    case 'month':
      return isoDate.slice(0, 7)
  }
}
