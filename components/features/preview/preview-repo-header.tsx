"use client"

import { Github, Star, GitFork, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { GitHubRepo } from "@/types/repository"

interface PreviewRepoHeaderProps {
  repo: GitHubRepo
  onDisconnect: () => void
}

export function PreviewRepoHeader({ repo, onDisconnect }: PreviewRepoHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-foreground/[0.06] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground/5">
          <Github className="h-4 w-4 text-text-secondary" />
        </div>
        <div>
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-text-primary hover:underline"
          >
            {repo.fullName}
          </a>
          <div className="flex items-center gap-3 text-xs text-text-muted">
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
        className="text-text-muted hover:text-status-error"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
