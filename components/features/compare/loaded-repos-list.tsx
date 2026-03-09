"use client"

import { RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { useComparison } from "@/providers/comparison-provider"
import type { ComparisonRepoStatus } from "@/types/comparison"

const STATUS_CONFIG: Record<
  ComparisonRepoStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  loading: { label: "Loading…", variant: "secondary" },
  indexing: { label: "Indexing…", variant: "secondary" },
  ready: { label: "Ready", variant: "default" },
  error: { label: "Error", variant: "destructive" },
}

export function LoadedReposList() {
  const { getRepoList, removeRepo, retryRepo } = useComparison()
  const repos = getRepoList()

  if (repos.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No repositories loaded. Add one above to start comparing.
      </p>
    )
  }

  return (
    <ul className="flex flex-wrap gap-2" role="list" aria-label="Loaded repositories">
      {repos.map((r) => {
        const cfg = STATUS_CONFIG[r.status]
        const isLoading = r.status === "loading" || r.status === "indexing"

        return (
          <li
            key={r.id}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/3 px-3 py-1.5 text-sm"
          >
            {isLoading && <Spinner className="h-3 w-3" />}
            <span className="font-medium text-text-primary">{r.id}</span>
            <Badge variant={cfg.variant} className="text-[10px] px-1.5 py-0">
              {cfg.label}
            </Badge>

            {r.status === "error" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-text-secondary hover:text-text-primary"
                onClick={() => retryRepo(r.id)}
                aria-label={`Retry ${r.id}`}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-text-secondary hover:text-destructive"
              onClick={() => removeRepo(r.id)}
              aria-label={`Remove ${r.id}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
