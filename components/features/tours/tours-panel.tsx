"use client"

import { useEffect, useState, useCallback } from "react"
import { Map, Plus, Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTours, useRepositoryData, useAPIKeys } from "@/providers"
import { executeToolLocally } from "@/lib/ai/client-tool-executor"
import type { Tour } from "@/types/tours"
import { TourList } from "./tour-list"
import { TourPlayback } from "./tour-playback"
import { TourGenerateDialog } from "./tour-generate-dialog"

interface ToursPanelProps {
  className?: string
  onNavigateToFile?: (path: string, line?: number) => void
}

export function ToursPanel({ className, onNavigateToFile }: ToursPanelProps) {
  const {
    tours,
    activeTour,
    activeStopIndex,
    isPlaying,
    loadTours,
    saveTour,
    deleteTour,
    startTour,
    stopTour,
    goToStop,
    nextStop,
    prevStop,
  } = useTours()
  const { repo, codeIndex } = useRepositoryData()
  const { getValidProviders, isHydrated } = useAPIKeys()

  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  // Load tours when repo changes
  useEffect(() => {
    if (repo?.fullName) {
      loadTours(repo.fullName)
    }
  }, [repo?.fullName, loadTours])

  const handleGenerate = useCallback(
    async (theme: string, maxStops: number) => {
      if (!repo?.fullName || !codeIndex) return

      setIsGenerating(true)
      try {
        const result = await executeToolLocally(
          "generateTour",
          {
            repoKey: repo.fullName,
            theme: theme || undefined,
            maxStops,
          },
          codeIndex,
        )

        const parsed = JSON.parse(result)
        if (parsed.error) {
          console.error("[tours-panel] Generation failed:", parsed.error)
          return
        }

        const generatedTour = parsed.tour as Tour
        await saveTour(generatedTour)
        if (repo?.fullName) loadTours(repo.fullName)
        setShowGenerateDialog(false)
      } catch (err) {
        console.error("[tours-panel] Generation error:", err)
      } finally {
        setIsGenerating(false)
      }
    },
    [repo?.fullName, codeIndex, saveTour, loadTours],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteTour(id)
    },
    [deleteTour],
  )

  // Playing view
  if (isPlaying && activeTour) {
    return (
      <div className={cn("flex h-full flex-col", className)}>
        <TourPlayback
          tour={activeTour}
          activeStopIndex={activeStopIndex}
          onPrev={prevStop}
          onNext={nextStop}
          onStop={stopTour}
          onGoToStop={goToStop}
          onNavigateToFile={onNavigateToFile}
        />
      </div>
    )
  }

  const hasRepo = !!repo && codeIndex && codeIndex.totalFiles > 0

  // List / empty view
  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Code Tours</h2>
          {tours.length > 0 && (
            <span className="text-xs text-muted-foreground">({tours.length})</span>
          )}
        </div>
        {hasRepo && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShowGenerateDialog(true)}
          >
            <Plus className="h-3 w-3" />
            Generate Tour
          </Button>
        )}
      </div>

      {/* Content */}
      {tours.length === 0 ? (
        <EmptyState
          hasRepo={!!hasRepo}
          onGenerate={() => setShowGenerateDialog(true)}
        />
      ) : (
        <TourList
          tours={tours}
          onStart={startTour}
          onDelete={handleDelete}
        />
      )}

      {/* Generate dialog */}
      <TourGenerateDialog
        open={showGenerateDialog}
        onOpenChange={setShowGenerateDialog}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
      />
    </div>
  )
}

function EmptyState({
  hasRepo,
  onGenerate,
}: {
  hasRepo: boolean
  onGenerate: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Map className="h-6 w-6 text-primary" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">No tours yet</h3>
        <p className="text-xs text-muted-foreground max-w-[280px]">
          {hasRepo
            ? "Generate an AI-powered tour to explore this codebase, or use the chat to create one."
            : "Connect a repository to generate code tours."}
        </p>
      </div>
      {hasRepo && (
        <Button size="sm" className="gap-1.5" onClick={onGenerate}>
          <Plus className="h-3.5 w-3.5" />
          Generate Tour
        </Button>
      )}
    </div>
  )
}
