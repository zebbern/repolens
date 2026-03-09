"use client"

import { useState } from "react"
import { AlertTriangle, ChevronRight, Package } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { useComparison } from "@/providers/comparison-provider"
import { compareDependencies } from "@/lib/compare/dependency-utils"
import { cn } from "@/lib/utils"

export function DependencyOverlap() {
  const { getRepoList } = useComparison()
  const repos = getRepoList()

  const readyReposWithDeps = repos.filter(
    (r) => r.status === "ready" && r.dependencies && !r.dependencies.fetchError
  )

  if (readyReposWithDeps.length < 2) {
    if (repos.some((r) => r.status === "ready")) {
      return (
        <p className="text-sm text-text-secondary">
          Need at least 2 repos with package.json to compare dependencies.
        </p>
      )
    }
    return (
      <p className="text-sm text-text-secondary">
        No repositories loaded yet. Add repositories above to compare their
        dependencies.
      </p>
    )
  }

  let comparison: ReturnType<typeof compareDependencies>
  try {
    comparison = compareDependencies(
      readyReposWithDeps.map((r) => ({
        id: r.id,
        deps: r.dependencies!.deps,
        devDeps: r.dependencies!.devDeps,
      }))
    )
  } catch {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-status-error/20 bg-status-error/5 px-4 py-3 text-sm text-status-error">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <p>
          Failed to compare dependencies. Some repository data may be malformed.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Shared dependencies */}
      <SharedDependenciesTable
        shared={comparison.shared}
        repoIds={readyReposWithDeps.map((r) => r.id)}
      />

      {/* Unique dependencies per repo */}
      {readyReposWithDeps.map((r) => {
        const uniqueDeps = comparison.unique[r.id] ?? []
        if (uniqueDeps.length === 0) return null

        return (
          <UniqueDepsList
            key={r.id}
            repoId={r.id}
            deps={uniqueDeps}
          />
        )
      })}
    </div>
  )
}

function SharedDependenciesTable({
  shared,
  repoIds,
}: {
  shared: Array<{ name: string; versions: Record<string, string> }>
  repoIds: string[]
}) {
  if (shared.length === 0) {
    return (
      <p className="text-sm text-text-secondary">No shared dependencies found.</p>
    )
  }

  return (
    <div className="rounded-lg border border-foreground/10 overflow-x-auto">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-foreground/10 bg-foreground/2">
        <Package className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium">Shared Dependencies</span>
        <Badge variant="secondary" className="text-xs">
          {shared.length}
        </Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[160px]">Package</TableHead>
            {repoIds.map((id) => (
              <TableHead key={id} className="min-w-[120px] text-center">
                {id.split("/")[1]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shared.map((dep) => (
            <TableRow key={dep.name}>
              <TableCell className="font-mono text-xs">
                {dep.name}
              </TableCell>
              {repoIds.map((id) => (
                <TableCell key={id} className="text-center font-mono text-xs text-text-secondary">
                  {dep.versions[id] ?? "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function UniqueDepsList({
  repoId,
  deps,
}: {
  repoId: string
  deps: string[]
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-foreground/10 px-4 py-3 text-sm font-medium hover:bg-foreground/3 transition-colors">
        <ChevronRight
          className={cn(
            "h-4 w-4 text-text-secondary transition-transform duration-200",
            isOpen && "rotate-90"
          )}
        />
        <span>Unique to {repoId}</span>
        <Badge variant="outline" className="text-xs">
          {deps.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {deps.map((dep) => (
            <Badge key={dep} variant="secondary" className="font-mono text-xs">
              {dep}
            </Badge>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
