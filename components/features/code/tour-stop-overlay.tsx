"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TourStop } from "@/types/tours"

interface TourStopOverlayProps {
  stop: TourStop
  stopIndex: number
  totalStops: number
}

export function TourStopOverlay({
  stop,
  stopIndex,
  totalStops,
}: TourStopOverlayProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  if (isCollapsed) {
    return (
      <div className="mx-4 my-2 animate-in fade-in duration-150">
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface-elevated border border-foreground/8 shadow-xs text-xs text-text-muted hover:text-text-primary hover:bg-surface-elevated/80 transition-colors cursor-pointer"
          onClick={() => setIsCollapsed(false)}
          aria-label="Expand tour annotation"
        >
          <ChevronDown className="h-3 w-3" />
          <span>
            Stop {stopIndex + 1}/{totalStops}
            {stop.title ? `: ${stop.title}` : ""}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="mx-4 my-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="bg-surface-elevated border border-foreground/8 rounded-lg shadow-lg max-w-md p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted bg-foreground/6 px-1.5 py-0.5 rounded shrink-0">
                {stopIndex + 1}/{totalStops}
              </span>
              {stop.title && (
                <span className="text-sm font-medium text-text-primary truncate">
                  {stop.title}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-text-muted hover:text-text-primary shrink-0 -mr-1 -mt-1"
            onClick={() => setIsCollapsed(true)}
            title="Collapse annotation"
            aria-label="Collapse tour annotation"
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
        </div>

        {/* Annotation content */}
        <div className="text-sm text-text-secondary prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:text-sm [&_p]:leading-relaxed [&_code]:text-xs [&_code]:bg-foreground/6 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-foreground/4 [&_pre]:p-2 [&_pre]:rounded-md [&_pre]:text-xs [&_ul]:text-sm [&_ol]:text-sm [&_li]:text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {stop.annotation}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
