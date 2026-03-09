"use client"

import { useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ChevronLeft, ChevronRight, Square, FileCode, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useRepositoryData } from "@/providers"
import { getFileLines } from "@/lib/code/code-index"
import type { Tour, TourStop } from "@/types/tours"

interface TourPlaybackProps {
  tour: Tour
  activeStopIndex: number
  onPrev: () => void
  onNext: () => void
  onStop: () => void
  onGoToStop: (index: number) => void
  onNavigateToFile?: (path: string, line?: number) => void
}

export function TourPlayback({
  tour,
  activeStopIndex,
  onPrev,
  onNext,
  onStop,
  onGoToStop,
  onNavigateToFile,
}: TourPlaybackProps) {
  const { codeIndex } = useRepositoryData()
  const totalStops = tour.stops.length
  const currentStop = tour.stops[activeStopIndex]
  const isFirst = activeStopIndex === 0
  const isLast = activeStopIndex === totalStops - 1

  const snippet = useMemo(() => {
    if (!currentStop || !codeIndex) return null
    const file = codeIndex.files.get(currentStop.filePath)
    if (!file) return null
    const lines = getFileLines(file).slice(
      Math.max(0, currentStop.startLine - 1),
      currentStop.endLine,
    )
    return lines.join("\n")
  }, [currentStop, codeIndex])

  if (!currentStop) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        This tour has no stops.
      </div>
    )
  }

  const fileName = currentStop.filePath.split("/").pop() ?? currentStop.filePath

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            Stop {activeStopIndex + 1} of {totalStops}
          </span>
          {currentStop.title && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-sm font-medium truncate">{currentStop.title}</span>
            </>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onStop}>
          <Square className="h-3 w-3" />
          Stop
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* File reference */}
          <button
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            onClick={() => onNavigateToFile?.(currentStop.filePath, currentStop.startLine)}
          >
            <FileCode className="h-3.5 w-3.5" />
            <span className="font-mono">
              {currentStop.filePath}
              <span className="text-muted-foreground/60 ml-1">
                L{currentStop.startLine}–{currentStop.endLine}
              </span>
            </span>
            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

          {/* Code snippet */}
          {snippet && (
            <div className="rounded-md border bg-muted/50 overflow-hidden">
              <pre className="p-3 text-xs font-mono leading-relaxed overflow-x-auto">
                <code>{snippet}</code>
              </pre>
            </div>
          )}

          {/* Annotation */}
          {currentStop.annotation && (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {currentStop.annotation}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Navigation footer */}
      <div className="flex items-center justify-between border-t px-4 py-2.5 bg-muted/30">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={onPrev}
          disabled={isFirst}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </Button>

        {/* Stop indicators */}
        <div className="flex items-center gap-1">
          {tour.stops.map((_, i) => (
            <button
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === activeStopIndex
                  ? "w-4 bg-primary"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50",
              )}
              onClick={() => onGoToStop(i)}
              aria-label={`Go to stop ${i + 1}`}
            />
          ))}
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={onNext}
          disabled={isLast}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
