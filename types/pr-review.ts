// PR Review Types

export type ReviewSeverity = 'critical' | 'warning' | 'suggestion' | 'praise'

export interface ReviewFinding {
  file: string
  line?: number
  endLine?: number
  severity: ReviewSeverity
  category: string
  message: string
  suggestion?: string
}

export interface PRMetadata {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed' | 'merged'
  author: string
  authorAvatarUrl: string | null
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  headRef: string
  baseRef: string
  headSha: string
  baseSha: string
  additions: number
  deletions: number
  changedFiles: number
  url: string
  isDraft: boolean
  labels: string[]
}

export type PRFileStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'

export interface PRFile {
  filename: string
  status: PRFileStatus
  additions: number
  deletions: number
  changes: number
  patch?: string
  previousFilename?: string
  contentsUrl: string
}

export interface PRComment {
  id: number
  body: string
  author: string
  authorAvatarUrl: string | null
  createdAt: string
  updatedAt: string
  path?: string
  line?: number
  side?: 'LEFT' | 'RIGHT'
  inReplyToId?: number
}

export type PRReviewStatus = 'idle' | 'loading-list' | 'loading-pr' | 'loading-files' | 'reviewing' | 'complete' | 'error'

export interface PRReviewState {
  pr: PRMetadata | null
  files: PRFile[]
  comments: PRComment[]
  findings: ReviewFinding[]
  status: PRReviewStatus
  error: string | null
}
