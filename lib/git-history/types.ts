import type { BlameCommit } from '@/types/git-history'
import type { GitHubCommit } from '@/types/repository'

/** Per-line blame information for the blame gutter view. */
export interface BlameLineInfo {
  lineNumber: number
  commit: BlameCommit
  age: number
  /** Whether this is the first line of a blame range (show full annotation). */
  isRangeStart: boolean
}

/** Per-author contribution stats computed from blame ranges. */
export interface BlameAuthorStats {
  name: string
  email: string
  login: string | null
  avatarUrl: string | null
  lineCount: number
  /** Percentage of total lines attributed to this author (0–100, 1 decimal). */
  percentage: number
}

/** Commits grouped by date (day granularity) for timeline rendering. */
export interface CommitGroup {
  /** ISO date key, e.g. "2024-01-15". */
  dateKey: string
  /** Human-friendly label, e.g. "January 15, 2024" or "Today". */
  label: string
  commits: GitHubCommit[]
}

/** Commits grouped by author. */
export interface AuthorCommitGroup {
  author: string
  login: string | null
  avatarUrl: string | null
  commits: GitHubCommit[]
}

/** Aggregate file-change statistics. */
export interface FileChangeStats {
  fileCount: number
  totalAdditions: number
  totalDeletions: number
}

/** A parsed hunk from a unified diff. */
export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

/** A single line within a diff hunk. */
export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

/** A fully parsed unified-diff patch. */
export interface ParsedPatch {
  hunks: DiffHunk[]
  isBinary: boolean
  isTruncated: boolean
}
