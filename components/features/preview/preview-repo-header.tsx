"use client"

import { Star, GitFork, X } from "lucide-react"
import { Github } from "@/components/icons/github"
import { Button } from "@/components/ui/button"
import type { GitHubRepo } from "@/types/repository"

interface PreviewRepoHeaderProps {
  repo: GitHubRepo
  onDisconnect: () => void
}

export function PreviewRepoHeader({ repo, onDisconnect }: PreviewRepoHeaderProps) {
  return (
    <div className="flex min-w-0 items-center justify-between border-b border-foreground/6 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground/5">
          <Github className="h-4 w-4 text-text-secondary" />
        </div>
        <div className="min-w-0">
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block min-w-0 truncate text-sm font-medium text-text-primary hover:underline"
          >
            {repo.fullName}
          </a>
          <div className="flex min-w-0 items-center gap-3 text-xs text-text-muted">
            {repo.language && <span>{repo.language}</span>}
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {repo.stars.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <GitFork className="h-3 w-3" />
              {repo.forks.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDisconnect}
        aria-label="Disconnect repository"
        title="Disconnect repository"
        className="shrink-0 text-text-muted hover:text-status-error"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
