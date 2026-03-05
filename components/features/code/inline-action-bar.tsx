"use client"

import React, { useCallback } from "react"
import { BookOpen, RefreshCw, Search, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { InlineActionType, SymbolRange } from "./types"

interface InlineActionBarProps {
  symbolRange: SymbolRange
  onAction: (type: InlineActionType) => void
  isVisible: boolean
  hasApiKey: boolean
}

const ACTION_BUTTONS: Array<{
  type: InlineActionType
  icon: React.ElementType
  label: string
  requiresAI: boolean
}> = [
  { type: "explain", icon: BookOpen, label: "Explain", requiresAI: true },
  { type: "refactor", icon: RefreshCw, label: "Suggest Refactor", requiresAI: true },
  { type: "find-usages", icon: Search, label: "Find Usages", requiresAI: false },
  { type: "complexity", icon: Gauge, label: "Show Complexity", requiresAI: true },
]

export function InlineActionBar({
  symbolRange,
  onAction,
  isVisible,
  hasApiKey,
}: InlineActionBarProps) {
  const handleAction = useCallback(
    (type: InlineActionType) => {
      onAction(type)
    },
    [onAction],
  )

  if (!isVisible) return null

  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="toolbar"
        aria-label="Code actions"
        className={cn(
          "absolute right-2 top-1/2 -translate-y-1/2 z-20",
          "flex items-center gap-0.5",
          "rounded-lg border border-foreground/[0.08] bg-surface-elevated shadow-md",
          "px-1 py-0.5",
          "animate-in fade-in slide-in-from-bottom-1 duration-150",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {ACTION_BUTTONS.map(({ type, icon: Icon, label, requiresAI }) => {
          const isDisabled = requiresAI && !hasApiKey
          const tooltipText = isDisabled
            ? "Configure an API key in Settings"
            : label

          return (
            <Tooltip key={type}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/[0.06]"
                  disabled={isDisabled}
                  aria-label={label}
                  onClick={() => handleAction(type)}
                >
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {tooltipText}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
