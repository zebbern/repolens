"use client"

import { useState, useMemo } from "react"
import { Search, GitPullRequest, GitMerge, Clock, Filter } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import type { PRMetadata } from "@/types/pr-review"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PRSelectorProps {
  pulls: PRMetadata[]
  isLoading: boolean
  onSelect: (pr: PRMetadata) => void
  onLoadPulls: (state: "open" | "closed" | "all") => void
}

// ---------------------------------------------------------------------------
// PRSelector
// ---------------------------------------------------------------------------

export function PRSelector({ pulls, isLoading, onSelect, onLoadPulls }: PRSelectorProps) {
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">("open")

  const filtered = useMemo(() => {
    if (!query.trim()) return pulls
    const lower = query.toLowerCase()
    return pulls.filter(
      (pr) =>
        pr.title.toLowerCase().includes(lower) ||
        String(pr.number).includes(lower) ||
        pr.author.toLowerCase().includes(lower),
    )
  }, [pulls, query])

  const handleStateChange = (state: "open" | "closed" | "all") => {
    setStateFilter(state)
    onLoadPulls(state)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-4">
        {/* Header */}
        <div className="text-center space-y-2">
          <GitPullRequest className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Select a Pull Request</h2>
          <p className="text-sm text-muted-foreground">
            Choose a pull request to inspect its changed files and diffs.
          </p>
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by title, number, or author…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center rounded-md border">
            {(["open", "closed", "all"] as const).map((state) => (
              <Button
                key={state}
                variant={stateFilter === state ? "secondary" : "ghost"}
                size="sm"
                className="h-9 rounded-none first:rounded-l-md last:rounded-r-md capitalize"
                onClick={() => handleStateChange(state)}
              >
                {state}
              </Button>
            ))}
          </div>
        </div>

        {/* PR list */}
        <ScrollArea className="h-100 rounded-md border">
          {isLoading ? (
            <div className="space-y-2 p-3" role="status" aria-live="polite" aria-label="Loading pull requests">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-md p-3">
                  <Skeleton className="h-5 w-5" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-[70%]" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground" role="status">
              {query ? "No PRs match your search" : "No pull requests found"}
            </div>
          ) : (
            <div className="space-y-0.5 p-1">
              {filtered.map((pr) => (
                <PRListItem key={pr.number} pr={pr} onSelect={() => onSelect(pr)} />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PRListItem
// ---------------------------------------------------------------------------

function PRListItem({ pr, onSelect }: { pr: PRMetadata; onSelect: () => void }) {
  const [showAllLabels, setShowAllLabels] = useState(false)
  const stateColor =
    pr.state === "merged"
      ? "text-purple-600 dark:text-purple-400"
      : pr.state === "closed"
        ? "text-red-600 dark:text-red-400"
        : "text-green-600 dark:text-green-400"

  const StateIcon = pr.state === "merged" ? GitMerge : GitPullRequest

  return (
    <div className="relative flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
      <button
        type="button"
        className="absolute inset-0 rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Select pull request #${pr.number}: ${pr.title}`}
        onClick={onSelect}
      />
      <StateIcon className={`pointer-events-none relative z-10 h-4 w-4 mt-0.5 shrink-0 ${stateColor}`} />
      <div className="pointer-events-none relative z-10 flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium truncate">{pr.title}</span>
          <span className="text-xs text-muted-foreground shrink-0">#{pr.number}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span>{pr.author}</span>
          <span>·</span>
          <span>{formatRelative(pr.updatedAt)}</span>
          {pr.isDraft && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
              Draft
            </Badge>
          )}
        </div>
        {pr.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {pr.labels.slice(0, showAllLabels ? pr.labels.length : 3).map((label) => (
              <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {label}
              </Badge>
            ))}
            {pr.labels.length > 3 && (
              <button
                type="button"
                className="pointer-events-auto text-[10px] text-muted-foreground hover:text-foreground"
                aria-expanded={showAllLabels}
                aria-label={showAllLabels
                  ? `Show fewer labels for pull request #${pr.number}`
                  : `View ${pr.labels.length - 3} more labels for pull request #${pr.number}`}
                onClick={() => setShowAllLabels((shown) => !shown)}
              >
                {showAllLabels ? 'Show less' : `+${pr.labels.length - 3}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
