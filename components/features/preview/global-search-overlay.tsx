"use client"

import { useRef, useEffect } from "react"
import { Search, Code2 } from "lucide-react"

interface FileResult {
  path: string
  name: string
}

interface GlobalSearchOverlayProps {
  query: string
  onQueryChange: (value: string) => void
  results: FileResult[]
  totalFileCount: number
  onSelect: (path: string) => void
  onClose: () => void
}

export function GlobalSearchOverlay({
  query,
  onQueryChange,
  results,
  totalFileCount,
  onSelect,
  onClose,
}: GlobalSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-[15%]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-popover border border-foreground/10 rounded-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-foreground/[0.06]">
          <Search className="h-4 w-4 text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search files by name or path..."
            className="flex-1 h-10 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && results.length > 0) onSelect(results[0].path)
            }}
          />
          <kbd className="text-[10px] text-text-muted/50 bg-foreground/[0.04] px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>
        {query.trim() ? (
          <div className="max-h-72 overflow-y-auto py-1">
            {results.length > 0 ? (
              results.map(f => (
                <button
                  key={f.path}
                  onClick={() => onSelect(f.path)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-foreground/5 transition-colors group"
                >
                  <Code2 className="h-3.5 w-3.5 text-text-muted shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-text-primary truncate group-hover:text-white">{f.name}</span>
                    <span className="text-[10px] text-text-muted truncate">{f.path}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-xs text-text-muted">No files found</div>
            )}
          </div>
        ) : (
          <div className="px-3 py-4 text-center text-xs text-text-muted">
            Type to search across {totalFileCount} files
          </div>
        )}
      </div>
    </div>
  )
}
