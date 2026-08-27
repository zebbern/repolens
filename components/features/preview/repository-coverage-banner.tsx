"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Database, Info, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { LoadingStage } from "@/providers/repository-provider"
import type { RepositoryCoverage } from "@/types/repository"

interface RepositoryCoverageBannerProps {
  coverage: RepositoryCoverage | null
  loadingStage: LoadingStage
  error?: string | null
  repositoryKey?: string
}

const SETTLED_STAGES = new Set<LoadingStage>(["ready", "cached"])

function coverageStatus(coverage: RepositoryCoverage | null, loadingStage: LoadingStage, error?: string | null) {
  if (error) {
    return {
      label: "Repository content loading failed — coverage is incomplete.",
      tone: "error" as const,
      Icon: AlertTriangle,
    }
  }

  if (!coverage) {
    return {
      label: "Discovering repository coverage…",
      tone: "loading" as const,
      Icon: Loader2,
    }
  }

  const isSettled = SETTLED_STAGES.has(loadingStage)
  const isPartial = coverage.treeStatus === "partial"
    || coverage.failures.count > 0
    || coverage.failedSubtrees.count > 0
    || (isSettled
      && coverage.mode === "full"
      && coverage.supportedFiles.loaded < coverage.supportedFiles.discovered)

  if (isPartial) {
    return {
      label: "Partial coverage — results may omit files.",
      tone: "warning" as const,
      Icon: AlertTriangle,
    }
  }
  if (!isSettled) {
    return {
      label: `Loading repository content — ${coverage.supportedFiles.loaded.toLocaleString()} of ${coverage.supportedFiles.discovered.toLocaleString()} supported files loaded.`,
      tone: "loading" as const,
      Icon: Loader2,
    }
  }
  if (coverage.supportedFiles.discovered === 0) {
    return {
      label: "No supported files found.",
      tone: "empty" as const,
      Icon: Info,
    }
  }
  if (coverage.mode === "on-demand") {
    return {
      label: `On-demand content — ${coverage.supportedFiles.loaded.toLocaleString()} of ${coverage.supportedFiles.discovered.toLocaleString()} supported files loaded. Additional content loads as needed.`,
      tone: "ondemand" as const,
      Icon: Database,
    }
  }
  return {
    label: `${coverage.supportedFiles.loaded.toLocaleString()} supported files indexed.`,
    tone: "complete" as const,
    Icon: CheckCircle2,
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-foreground/6 last:border-0">
      <th scope="row" className="py-2 pr-4 text-left text-xs font-medium text-text-secondary">
        {label}
      </th>
      <td className="py-2 text-right text-xs text-text-primary">{value}</td>
    </tr>
  )
}

export function RepositoryCoverageBanner({ coverage, loadingStage, error, repositoryKey }: RepositoryCoverageBannerProps) {
  const status = coverageStatus(coverage, loadingStage, error)
  const Icon = status.Icon
  const repositoryIdentity = repositoryKey ?? ""
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [autoDismissCancelledKey, setAutoDismissCancelledKey] = useState<string | null>(null)
  const dismissed = dismissedKey === repositoryIdentity
  const autoDismissCancelled = autoDismissCancelledKey === repositoryIdentity

  useEffect(() => {
    if (status.tone !== "complete" || dismissed || autoDismissCancelled) return
    const timer = setTimeout(() => setDismissedKey(repositoryIdentity), 10_000)
    return () => clearTimeout(timer)
  }, [autoDismissCancelled, dismissed, repositoryIdentity, status.tone])

  if (status.tone === "complete" && dismissed) return null

  const fileFailureSamples = coverage?.failures.samples.slice(0, 100) ?? []
  const failedSubtreeSamples = coverage?.failedSubtrees.samples.slice(0, 100) ?? []
  const discoveredLabel = coverage?.treeStatus === "partial"
    ? `At least ${coverage.supportedFiles.discovered.toLocaleString()}`
    : (coverage?.supportedFiles.discovered.toLocaleString() ?? "Pending")

  return (
    <div
      className={cn(
        "flex min-h-9 shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs",
        status.tone === "warning" && "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300",
        status.tone === "error" && "border-status-error/20 bg-status-error/8 text-status-error",
        status.tone === "complete" && "border-emerald-500/15 bg-emerald-500/6 text-emerald-700 dark:text-emerald-300",
        status.tone === "ondemand" && "border-blue-500/15 bg-blue-500/6 text-blue-700 dark:text-blue-300",
        (status.tone === "loading" || status.tone === "empty") && "border-foreground/6 bg-foreground/2 text-text-secondary",
      )}
      role={status.tone === "error" ? "alert" : "status"}
      aria-live={status.tone === "error" ? "assertive" : "polite"}
      onFocusCapture={() => setAutoDismissCancelledKey(repositoryIdentity)}
      onPointerEnter={() => setAutoDismissCancelledKey(repositoryIdentity)}
      onPointerDown={() => setAutoDismissCancelledKey(repositoryIdentity)}
      onClick={() => setAutoDismissCancelledKey(repositoryIdentity)}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", status.tone === "loading" && "animate-spin")} aria-hidden="true" />
      <span className="min-w-0 flex-1">{status.label}</span>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-[11px]">
            Details
          </Button>
        </DialogTrigger>
        {status.tone === "complete" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label="Dismiss repository coverage"
            onClick={() => setDismissedKey(repositoryIdentity)}
          >
            <X aria-hidden="true" />
          </Button>
        )}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Repository coverage details</DialogTitle>
            <DialogDescription>
              Coverage describes which repository files RepoLens discovered and loaded. It does not measure finding accuracy.
            </DialogDescription>
          </DialogHeader>

          <table className="w-full">
            <caption className="sr-only">Repository discovery and content coverage</caption>
            <tbody>
              <DetailRow
                label="Tree discovery"
                value={!coverage ? "Pending" : coverage.treeStatus === "complete" ? "Complete" : "Partial (GitHub tree was truncated)"}
              />
              <DetailRow label="Supported files discovered" value={discoveredLabel} />
              <DetailRow
                label="Supported content loaded"
                value={!coverage
                  ? "Pending"
                  : `${coverage.supportedFiles.loaded.toLocaleString()} of ${coverage.supportedFiles.discovered.toLocaleString()}`}
              />
              <DetailRow label="File-load failures" value={coverage?.failures.count.toLocaleString() ?? "Pending"} />
              <DetailRow label="Failed subtrees" value={coverage?.failedSubtrees.count.toLocaleString() ?? "Pending"} />
              <DetailRow label="Content mode" value={!coverage ? "Pending" : coverage.mode === "on-demand" ? "On-demand" : "Full"} />
            </tbody>
          </table>

          {error && (
            <p className="rounded-md bg-status-error/10 p-3 text-xs text-status-error" role="alert">
              Repository content loading stopped: {error}
            </p>
          )}

          {coverage?.treeStatus === "partial" && (
            <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              GitHub did not return a complete tree. The discovered-file count is a minimum, and undiscovered paths cannot be analyzed.
            </p>
          )}

          {coverage && coverage.failures.count > 0 && (
            <section aria-labelledby="coverage-file-failures" className="space-y-2">
              <h3 id="coverage-file-failures" className="text-sm font-medium">
                File-load failures ({coverage.failures.count.toLocaleString()})
              </h3>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 font-mono text-[11px]">
                {fileFailureSamples.map(({ path, error }) => (
                  <li key={`${path}:${error}`} className="break-all">
                    <span className="text-text-primary">{path}</span>
                    <span className="text-text-muted"> — {error}</span>
                  </li>
                ))}
              </ul>
              {coverage.failures.count > fileFailureSamples.length && (
                <p className="text-xs text-text-muted">
                  Showing the first {fileFailureSamples.length.toLocaleString()} failures.
                </p>
              )}
            </section>
          )}

          {coverage && coverage.failedSubtrees.count > 0 && (
            <section aria-labelledby="coverage-failed-subtrees" className="space-y-2">
              <h3 id="coverage-failed-subtrees" className="text-sm font-medium">
                Failed subtrees ({coverage.failedSubtrees.count.toLocaleString()})
              </h3>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 font-mono text-[11px]">
                {failedSubtreeSamples.map(path => (
                  <li key={path} className="break-all">{path}</li>
                ))}
              </ul>
              {coverage.failedSubtrees.count > failedSubtreeSamples.length && (
                <p className="text-xs text-text-muted">
                  Showing the first {failedSubtreeSamples.length.toLocaleString()} failed subtrees.
                </p>
              )}
            </section>
          )}

          {coverage?.mode === "on-demand" && (
            <p className="rounded-md bg-blue-500/10 p-3 text-xs text-blue-800 dark:text-blue-200">
              On-demand mode indexes supported file metadata first and loads content only when a feature needs it.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
