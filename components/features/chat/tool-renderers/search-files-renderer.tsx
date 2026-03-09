"use client"

import { Search } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface MatchEntry {
  line: number
  content: string
  context?: string[]
}

interface SearchResult {
  path: string
  matchType: "path" | "content"
  matches?: MatchEntry[]
  totalMatches?: number
}

interface SearchFilesResult {
  totalFiles?: number
  matchCount?: number
  results?: SearchResult[]
  warning?: string
  error?: string
}

export default function SearchFilesRenderer({ result, args }: ToolRendererProps) {
  const data = parseToolResult<SearchFilesResult>(result)
  if (!data || data.error) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  const query = typeof args.query === "string" ? args.query : ""
  const results = data.results ?? []

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden max-h-75 overflow-y-auto">
      {/* Summary */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3 sticky top-0">
        <Search className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] text-text-secondary">
          {data.matchCount ?? results.length} match{(data.matchCount ?? results.length) !== 1 && "es"}
          {data.totalFiles != null && (
            <span className="text-text-muted"> across {data.totalFiles} files</span>
          )}
        </span>
      </div>

      {data.warning && (
        <div className="px-2 py-0.5 text-[10px] text-amber-600 bg-amber-500/10 border-b border-foreground/6">
          {data.warning}
        </div>
      )}

      {results.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-text-muted italic">No matches found</div>
      ) : (
        <div className="divide-y divide-foreground/6">
          {results.map((r, i) => (
            <SearchResultEntry key={i} entry={r} query={query} />
          ))}
        </div>
      )}
    </div>
  )
}

function SearchResultEntry({ entry, query }: { entry: SearchResult; query: string }) {
  return (
    <div className="px-2 py-1">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] font-mono text-blue-500 truncate">{entry.path}</span>
        {entry.totalMatches != null && (
          <span className="text-[10px] text-text-muted shrink-0">({entry.totalMatches})</span>
        )}
      </div>
      {entry.matches && entry.matches.length > 0 && (
        <div className="mt-0.5 space-y-px">
          {entry.matches.slice(0, 5).map((m, j) => (
            <div key={j} className="flex gap-1.5 text-[11px] font-mono">
              <span className="text-text-muted shrink-0 w-8 text-right">L{m.line}</span>
              <span className="text-text-secondary truncate">
                <HighlightedText text={m.content} query={query} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>

  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`(${escaped})`, "gi")
    const parts = text.split(regex)

    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-yellow-300/30 text-yellow-700 dark:text-yellow-300 rounded-sm px-px">
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </>
    )
  } catch {
    return <>{text}</>
  }
}
