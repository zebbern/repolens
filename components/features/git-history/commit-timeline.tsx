"use client"

import { GitCommit, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CommitRow } from "./git-history-helpers"
import type { CommitGroup } from "@/lib/git-history"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CommitTimelineProps {
  commitGroups: CommitGroup[]
  onCommitClick: (sha: string) => void
  onLoadMore: () => void
  hasMore: boolean
  isLoading: boolean
}

// ---------------------------------------------------------------------------
// CommitTimeline
// ---------------------------------------------------------------------------

export function CommitTimeline({
  commitGroups,
  onCommitClick,
  onLoadMore,
  hasMore,
  isLoading,
}: CommitTimelineProps) {
  if (commitGroups.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <GitCommit className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No commits found</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-1 overflow-auto p-4">
      {commitGroups.map((group) => (
        <div key={group.dateKey} className="mb-3">
          {/* Date header */}
          <h3 className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2 px-1 border-b mb-1">
            {group.label}
          </h3>

          {/* Commit rows */}
          <div className="flex flex-col">
            {group.commits.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} onSelect={onCommitClick} />
            ))}
          </div>
        </div>
      ))}

      {/* Load more / loading */}
      <div className="flex justify-center py-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading commits…
          </div>
        ) : hasMore ? (
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Load more
          </Button>
        ) : commitGroups.length > 0 ? (
          <p className="text-xs text-muted-foreground">All commits loaded</p>
        ) : null}
      </div>
    </div>
  )
}
