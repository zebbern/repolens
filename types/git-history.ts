// Git History & Blame Explorer types

// ---------------------------------------------------------------------------
// Blame types — mapped from GitHub GraphQL API response
// ---------------------------------------------------------------------------

export interface BlameUser {
  login: string
  avatarUrl: string
}

export interface BlameAuthor {
  name: string | null
  email: string | null
  date: string | null
  user: BlameUser | null
}

export interface BlameCommit {
  oid: string
  abbreviatedOid: string
  message: string
  messageHeadline: string
  committedDate: string
  url: string
  author: BlameAuthor | null
}

export interface BlameRange {
  startingLine: number
  endingLine: number
  age: number
  commit: BlameCommit
}

export interface BlameData {
  ranges: BlameRange[]
  isTruncated: boolean
  byteSize: number
}

// ---------------------------------------------------------------------------
// Commit detail types — from GitHub REST API single commit endpoint
// ---------------------------------------------------------------------------

export interface CommitStats {
  additions: number
  deletions: number
  total: number
}

export interface CommitFile {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  changes: number
  patch?: string
  previousFilename?: string
}

export interface CommitDetail {
  sha: string
  message: string
  authorName: string
  authorEmail: string
  authorDate: string
  committerName: string
  committerDate: string
  url: string
  authorLogin: string | null
  authorAvatarUrl: string | null
  parents: Array<{ sha: string }>
  stats: CommitStats
  files: CommitFile[]
}
