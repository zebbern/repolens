"use client"

import { useState, useEffect, useCallback } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import { useRepositoryData } from "@/providers"
import { usePRReviewState, usePRReviewActions } from "@/providers/pr-review-provider"
import { PRSelector } from "./pr-selector"
import { PRHeader } from "./pr-header"
import { FileNavigator } from "./file-navigator"
import { DiffViewer } from "./diff-viewer"
import { ReviewSummary } from "./review-comments"

// ---------------------------------------------------------------------------
// PRReviewPanel
// ---------------------------------------------------------------------------

export function PRReviewPanel() {
  const { repo } = useRepositoryData()
  const { pr, files, findings, status, error, availablePRs, isFileTruncated } = usePRReviewState()
  const { loadPRList, selectPR, reset } = usePRReviewActions()

  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)

  const owner = repo?.owner ?? ""
  const name = repo?.name ?? ""

  // Load PRs when repo is available
  useEffect(() => {
    if (owner && name) {
      loadPRList(owner, name)
    }
  }, [owner, name, loadPRList])

  const handleSelectPR = useCallback(
    (prMeta: { number: number }) => {
      if (owner && name) {
        setSelectedFilename(null)
        selectPR(owner, name, prMeta.number)
      }
    },
    [owner, name, selectPR],
  )

  const handleLoadPulls = useCallback(
    (state: "open" | "closed" | "all") => {
      if (owner && name) {
        loadPRList(owner, name, state)
      }
    },
    [owner, name, loadPRList],
  )

  const handleBack = useCallback(() => {
    reset()
  }, [reset])

  // No repo connected — show a prompt
  if (!repo) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center" role="alert">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Connect a GitHub repository to review pull requests.
          </p>
        </div>
      </div>
    )
  }

  // Error state
  if (status === "error" && error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center" role="alert">
        <div className="space-y-3">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            className="text-sm text-muted-foreground underline hover:text-foreground"
            onClick={handleBack}
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  // Loading state
  if (status === "loading-pr" || status === "loading-files") {
    return (
      <div className="flex h-full items-center justify-center p-8" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status === "loading-pr" ? "Loading pull request…" : "Loading files…"}
        </div>
      </div>
    )
  }

  // No PR selected — show selector
  if (!pr) {
    return (
      <PRSelector
        pulls={availablePRs}
        isLoading={status === "loading-list"}
        onSelect={handleSelectPR}
        onLoadPulls={handleLoadPulls}
      />
    )
  }

  // PR selected — show header + sidebar + diff view
  const effectiveSelectedFilename = selectedFilename ?? files[0]?.filename ?? null
  const selectedFile = files.find((f) => f.filename === effectiveSelectedFilename) ?? files[0] ?? null
  const fileFindings = findings.filter((f) => f.file === selectedFile?.filename)

  return (
    <div className="flex h-full flex-col">
      {/* PR header with summary */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <PRHeader pr={pr} onBack={handleBack} />
        </div>
      </div>

      {/* Review summary bar */}
      {findings.length > 0 && (
        <div className="shrink-0 border-b px-4 py-2">
          <ReviewSummary findings={findings} />
        </div>
      )}

      {/* Main content: sidebar + diff */}
      <div className="flex flex-1 overflow-hidden">
        <FileNavigator
          files={files}
          selectedFile={effectiveSelectedFilename}
          onSelectFile={setSelectedFilename}
          totalChangedFiles={pr?.changedFiles}
          isFileTruncated={isFileTruncated}
        />
        <div className="flex-1 overflow-hidden">
          {selectedFile ? (
            <DiffViewer file={selectedFile} findings={fileFindings} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file to view its diff
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
