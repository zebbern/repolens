"use client"

import { useEffect, useState, useCallback } from "react"
import { Clock, Star, GitBranch, X, FileCode } from "lucide-react"
import { cn } from "@/lib/utils"
import { listCachedRepos, clearCachedRepo, type CachedRepoMeta } from "@/lib/cache/repo-cache"

interface RecentReposProps {
  onConnectWithUrl: (url: string) => void
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function formatStars(stars: number): string {
  if (stars >= 1000) return `${(stars / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return String(stars)
}

export function RecentRepos({ onConnectWithUrl }: RecentReposProps) {
  const [repos, setRepos] = useState<CachedRepoMeta[]>([])

  useEffect(() => {
    listCachedRepos().then(setRepos)
  }, [])

  const handleRemove = useCallback(
    async (e: React.MouseEvent, owner: string, repo: string) => {
      e.stopPropagation()
      await clearCachedRepo(owner, repo)
      setRepos((prev) => prev.filter((r) => r.key !== `${owner}/${repo}`))
    },
    [],
  )

  const handleClick = useCallback(
    (owner: string, repo: string) => {
      onConnectWithUrl(`https://github.com/${owner}/${repo}`)
    },
    [onConnectWithUrl],
  )

  if (repos.length === 0) return null

  return (
    <section className="w-full max-w-md pt-6">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">
        Recently Analyzed
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {repos.map((repo) => (
          <button
            key={repo.key}
            type="button"
            onClick={() => handleClick(repo.owner, repo.repo)}
            className={cn(
              "group relative flex flex-col gap-1.5 rounded-lg border border-foreground/8 bg-foreground/3 p-3 text-left transition-all",
              "hover:border-foreground/15 hover:bg-foreground/6",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50",
            )}
          >
            {/* Remove button */}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => handleRemove(e, repo.owner, repo.repo)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  handleRemove(e as unknown as React.MouseEvent, repo.owner, repo.repo)
                }
              }}
              className="absolute right-2 top-2 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:text-text-secondary group-hover:opacity-100"
              aria-label={`Remove ${repo.key} from cache`}
            >
              <X className="h-3 w-3" />
            </span>

            {/* Repo name */}
            <div className="flex items-center gap-1.5 pr-5">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary/70" />
              <span className="truncate text-sm font-medium text-text-primary">
                {repo.key}
              </span>
            </div>

            {/* Description */}
            {repo.description && (
              <p className="line-clamp-1 text-xs text-text-muted">
                {repo.description}
              </p>
            )}

            {/* Metadata row */}
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              {repo.stars != null && (
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3" />
                  {formatStars(repo.stars)}
                </span>
              )}
              {repo.language && (
                <span className="flex items-center gap-1">
                  <FileCode className="h-3 w-3" />
                  {repo.language}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatRelativeTime(repo.timestamp)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
