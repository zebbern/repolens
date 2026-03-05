"use client"

import React from "react"
import { X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { cn } from "@/lib/utils"
import type { InlineActionResult, InlineActionType } from "./types"

interface InlineActionPanelProps {
  result: InlineActionResult | null
  onClose: () => void
  isOpen: boolean
}

const ACTION_LABELS: Record<InlineActionType, string> = {
  explain: "Explanation",
  refactor: "Refactor Suggestions",
  "find-usages": "Usages",
  complexity: "Complexity Analysis",
}

export function InlineActionPanel({
  result,
  onClose,
  isOpen,
}: InlineActionPanelProps) {
  if (!isOpen) return null

  return (
    <div
      role="complementary"
      aria-label="Code analysis results"
      className={cn(
        "w-[350px] shrink-0 flex flex-col",
        "bg-background border-l border-foreground/[0.06]",
        "animate-in slide-in-from-right-2 duration-200",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-foreground/[0.06]">
        <div className="flex items-center gap-2 min-w-0">
          {result && (
            <>
              <span className="text-sm font-medium text-text-primary truncate">
                {result.symbolName}
              </span>
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 shrink-0"
              >
                {ACTION_LABELS[result.type]}
              </Badge>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-text-secondary hover:text-text-primary"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {result === null ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-text-muted">
              Select a symbol action to see results
            </p>
          </div>
        ) : result.error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <p className="text-sm text-status-error">{result.error}</p>
          </div>
        ) : (
          <>
            {result.isStreaming && (
              <div className="flex items-center gap-2 mb-3 text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-xs">Analyzing...</span>
              </div>
            )}
            {result.content ? (
              <MarkdownRenderer content={result.content} className="text-sm" />
            ) : (
              !result.isStreaming && (
                <p className="text-sm text-text-muted">No results</p>
              )
            )}
          </>
        )}
      </div>
    </div>
  )
}
