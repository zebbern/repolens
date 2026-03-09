"use client"

import { useEffect, useCallback } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Tour } from "@/types/tours"

interface TourPlayerBarProps {
  tour: Tour
  activeStopIndex: number
  onPrev: () => void
  onNext: () => void
  onStop: () => void
  onGoToStop: (index: number) => void
}

export function TourPlayerBar({
  tour,
  activeStopIndex,
  onPrev,
  onNext,
  onStop,
  onGoToStop,
}: TourPlayerBarProps) {
  const totalStops = tour.stops.length
  const currentStop = tour.stops[activeStopIndex]
  const isFirst = activeStopIndex === 0
  const isLast = activeStopIndex === totalStops - 1
  const progressPercent = totalStops > 1 ? (activeStopIndex / (totalStops - 1)) * 100 : 100

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept keys when the user is typing in an input or editable element
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault()
        if (!isFirst) onPrev()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        if (!isLast) onNext()
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onStop()
      }
    },
    [isFirst, isLast, onPrev, onNext, onStop],
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  if (!currentStop) return null

  return (
    <div
      className="relative bg-surface-elevated border-b border-foreground/6 animate-in slide-in-from-top-1 duration-200"
      role="toolbar"
      aria-label="Tour player controls"
    >
      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-foreground/4">
        <div
          className="h-full bg-accent-primary transition-all duration-300 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex items-center gap-2 h-10 px-3 pt-0.5">
        {/* Navigation */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-text-muted hover:text-text-primary"
            onClick={onPrev}
            disabled={isFirst}
            title="Previous stop (←)"
            aria-label="Previous stop"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-text-muted hover:text-text-primary"
            onClick={onNext}
            disabled={isLast}
            title="Next stop (→)"
            aria-label="Next stop"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Stop info */}
        <div className="flex-1 min-w-0 flex items-center gap-2" role="status" aria-live="polite" aria-atomic="true">
          <span className="text-xs text-text-muted shrink-0">
            {activeStopIndex + 1}/{totalStops}
          </span>
          <span className="text-xs font-medium text-text-primary truncate">
            {currentStop.title || currentStop.filePath}
          </span>
          <span className="text-[10px] text-text-muted truncate hidden sm:inline">
            {currentStop.filePath}:{currentStop.startLine}
          </span>
        </div>

        {/* Stop dots */}
        <div className="hidden md:flex items-center gap-0.5 shrink-0" role="group" aria-label="Tour stop indicators">
          {tour.stops.map((_, idx) => (
            <button
              key={idx}
              className="p-2 -m-2 flex items-center justify-center cursor-pointer"
              onClick={() => onGoToStop(idx)}
              title={`Go to stop ${idx + 1}`}
              aria-label={`Go to stop ${idx + 1}`}
            >
              <span className={cn(
                "w-1.5 h-1.5 rounded-full block transition-colors",
                idx === activeStopIndex
                  ? "bg-accent-primary"
                  : idx < activeStopIndex
                    ? "bg-accent-primary/40"
                    : "bg-foreground/10"
              )} />
            </button>
          ))}
        </div>

        {/* Stop tour button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-text-muted hover:text-status-error shrink-0"
          onClick={onStop}
          title="Stop tour (Esc)"
          aria-label="Stop tour"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
