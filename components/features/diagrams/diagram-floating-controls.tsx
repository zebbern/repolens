"use client"

import { useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FullAnalysis } from '@/lib/code/import-parser'

interface DiagramFloatingControlsProps {
  analysis: FullAnalysis | null
  focusOpen: boolean
  setFocusOpen: (open: boolean) => void
  focusQuery: string
  setFocusQuery: (query: string) => void
  focusTarget: string | null
  setFocusTarget: (target: string | null) => void
  focusHops: 1 | 2
  setFocusHops: (hops: 1 | 2) => void
  focusSuggestions: string[]
  onFocusSelect: (path: string) => void
  onClearFocus: () => void
  zoom: number
  setZoom: (fn: (z: number) => number) => void
  onResetView: () => void
}

export function DiagramFloatingControls({
  analysis,
  focusOpen,
  setFocusOpen,
  focusQuery,
  setFocusQuery,
  focusTarget,
  setFocusTarget,
  focusHops,
  setFocusHops,
  focusSuggestions,
  onFocusSelect,
  onClearFocus,
  zoom,
  setZoom,
  onResetView,
}: DiagramFloatingControlsProps) {
  const focusInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the input when focus search opens
  useEffect(() => {
    if (focusOpen) setTimeout(() => focusInputRef.current?.focus(), 50)
  }, [focusOpen])

  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-2">
      {/* Focus on file search */}
      {analysis && (
        <div className="relative">
          <div className="flex items-center gap-0.5 rounded-lg border border-foreground/10 bg-card/90 backdrop-blur-xs shadow-lg">
            {!focusOpen && !focusTarget ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-text-secondary hover:text-text-primary"
                onClick={() => setFocusOpen(true)}
                title="Focus on file"
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <div className="flex items-center px-1">
                <Search className="h-3.5 w-3.5 text-text-muted shrink-0 ml-1" />
                <Input
                  ref={focusInputRef}
                  value={focusQuery}
                  onChange={(e) => { setFocusQuery(e.target.value); if (!e.target.value) setFocusTarget(null) }}
                  onBlur={() => { if (!focusQuery && !focusTarget) setTimeout(() => setFocusOpen(false), 150) }}
                  placeholder="Focus on file..."
                  className="h-7 w-36 border-0 bg-transparent text-xs focus-visible:ring-0 px-1.5"
                />
                {focusTarget && (
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => setFocusHops(1)}
                      className={cn('text-[10px] px-1.5 py-0.5 rounded', focusHops === 1 ? 'bg-amber-500/20 text-amber-400' : 'text-text-muted hover:text-text-secondary')}
                    >
                      1-hop
                    </button>
                    <button
                      onClick={() => setFocusHops(2)}
                      className={cn('text-[10px] px-1.5 py-0.5 rounded', focusHops === 2 ? 'bg-amber-500/20 text-amber-400' : 'text-text-muted hover:text-text-secondary')}
                    >
                      2-hop
                    </button>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-text-muted hover:text-text-secondary"
                  onClick={onClearFocus}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          {/* Suggestions dropdown -- opens upward */}
          {focusOpen && focusQuery && !focusTarget && focusSuggestions.length > 0 && (
            <div className="absolute bottom-full right-0 mb-1 w-64 bg-popover border border-foreground/10 rounded-md shadow-lg z-50 overflow-hidden">
              {focusSuggestions.map(p => (
                <button
                  key={p}
                  onClick={() => onFocusSelect(p)}
                  className="w-full text-left text-xs px-3 py-1.5 text-text-secondary hover:bg-foreground/5 hover:text-text-primary truncate"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5 rounded-lg border border-foreground/10 bg-card/90 backdrop-blur-xs shadow-lg">
        <Button variant="ghost" size="icon" className="h-7 w-7 text-text-secondary hover:text-text-primary" onClick={() => setZoom(z => Math.max(0.2, z - 0.15))}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <button onClick={onResetView} className="text-xs text-text-muted hover:text-text-primary w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-text-secondary hover:text-text-primary" onClick={() => setZoom(z => Math.min(4, z + 0.15))}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <div className="w-px h-4 bg-foreground/10" />
        <Button variant="ghost" size="icon" className="h-7 w-7 text-text-secondary hover:text-text-primary" onClick={onResetView} title="Reset view">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
