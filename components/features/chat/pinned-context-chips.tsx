"use client"

import { useCallback, useRef } from "react"
import { File, Folder, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { PinnedFile } from "@/types/types"
import { PINNED_CONTEXT_CONFIG } from "@/config/constants"

interface PinnedContextChipsProps {
  pinnedFiles: Map<string, PinnedFile>
  onUnpin: (path: string) => void
  onClearAll: () => void
  totalBytes: number
}

/** Format byte count as a compact string (e.g. "2.1 KB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`
}

/** Extract the last path segment as display name. */
function getDisplayName(path: string): string {
  const segments = path.split("/")
  return segments[segments.length - 1] || path
}

export function PinnedContextChips({
  pinnedFiles,
  onUnpin,
  onClearAll,
  totalBytes,
}: PinnedContextChipsProps) {
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const entries = Array.from(pinnedFiles.entries())

  const handleUnpin = useCallback(
    (path: string, index: number) => {
      // Focus management: move focus to next chip, or previous, or nowhere
      const paths = Array.from(pinnedFiles.keys())
      const nextPath = paths[index + 1] ?? paths[index - 1]
      onUnpin(path)

      if (nextPath) {
        // Small delay to allow DOM to update after state change
        requestAnimationFrame(() => {
          chipRefs.current.get(nextPath)?.focus()
        })
      }
    },
    [pinnedFiles, onUnpin],
  )

  const handleChipKeyDown = useCallback(
    (e: React.KeyboardEvent, path: string, index: number) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        handleUnpin(path, index)
      }
    },
    [handleUnpin],
  )

  if (entries.length === 0) return null

  const isNearLimit = totalBytes > PINNED_CONTEXT_CONFIG.MAX_PINNED_BYTES * 0.8
  const fileCount = entries.length

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5 scrollbar-hide"
      role="list"
      aria-label="Pinned files"
      aria-live="polite"
    >
      {entries.map(([path, pin], index) => {
        const displayName = getDisplayName(path)
        const Icon = pin.type === "directory" ? Folder : File
        return (
          <TooltipProvider key={path} delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={(el) => {
                    if (el) chipRefs.current.set(path, el)
                    else chipRefs.current.delete(path)
                  }}
                  className={cn(
                    "group flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                    "border-accent-primary/20 bg-accent-primary/10 text-text-secondary",
                    "hover:bg-accent-primary/20 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-accent-primary",
                  )}
                  onKeyDown={(e) => handleChipKeyDown(e, path, index)}
                  aria-label={`Pinned ${pin.type}: ${path}. Press Delete to unpin.`}
                >
                  <Icon className="h-3 w-3 shrink-0 text-text-muted" />
                  <span className="max-w-[120px] truncate">{displayName}</span>
                  <span
                    className="ml-0.5 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    role="presentation"
                    aria-hidden="true"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleUnpin(path, index)
                    }}
                  >
                    <X className="h-3 w-3 hover:text-status-error" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {path}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      })}

      {/* Size indicator */}
      <span
        className={cn(
          "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
          isNearLimit
            ? "bg-status-warning/10 text-status-warning"
            : "bg-foreground/5 text-text-muted",
        )}
      >
        {fileCount} {fileCount === 1 ? "file" : "files"} · {formatBytes(totalBytes)}
      </span>

      {/* Clear all button */}
      {entries.length >= 2 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-[10px] text-text-muted hover:text-status-error"
          onClick={onClearAll}
          aria-label="Clear all pinned files"
        >
          Clear all
        </Button>
      )}
    </div>
  )
}
