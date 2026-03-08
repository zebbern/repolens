"use client"

import { useMemo } from "react"
import { FileText, GitCommit } from "lucide-react"
import type { GitHubCommit } from "@/types/repository"
import { groupCommitsByDate } from "@/lib/git-history"
import { CommitRow } from "./git-history-helpers"
import { Loader2 } from "lucide-react"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FileHistoryListProps {
  commits: GitHubCommit[]
  filePath: string
  onCommitClick: (sha: string) => void
  isLoading: boolean
}

// ---------------------------------------------------------------------------
// FileHistoryList
// ---------------------------------------------------------------------------

export function FileHistoryList({
  commits,
  filePath,
  onCommitClick,
  isLoading,
}: FileHistoryListProps) {
  const groups = useMemo(() => groupCommitsByDate(commits), [commits])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading file history…
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <GitCommit className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No commits found for this file</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-1 overflow-auto p-4">
      {/* File header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{filePath}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          {commits.length} commit{commits.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grouped commits */}
      {groups.map((group) => (
        <div key={group.dateKey} className="mb-3">
          <h3 className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2 px-1 border-b mb-1">
            {group.label}
          </h3>

          <div className="flex flex-col">
            {group.commits.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} onSelect={onCommitClick} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
