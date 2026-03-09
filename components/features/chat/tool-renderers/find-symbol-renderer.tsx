"use client"

import { Code2 } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface SymbolResult {
  path: string
  line: number
  kind: string
  match: string
}

interface FindSymbolResult {
  symbolName?: string
  matchCount?: number
  results?: SymbolResult[]
  warning?: string
  error?: string
}

const KIND_COLORS: Record<string, string> = {
  function: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  class: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  interface: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  type: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  variable: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  constant: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
}

export default function FindSymbolRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<FindSymbolResult>(result)
  if (!data || data.error) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  const results = data.results ?? []

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden max-h-75 overflow-y-auto">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3 sticky top-0">
        <Code2 className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] text-text-secondary">
          <span className="font-mono font-medium">{data.symbolName}</span>
          {" — "}
          {data.matchCount ?? results.length} match{(data.matchCount ?? results.length) !== 1 && "es"}
        </span>
      </div>

      {data.warning && (
        <div className="px-2 py-0.5 text-[10px] text-amber-600 bg-amber-500/10 border-b border-foreground/6">
          {data.warning}
        </div>
      )}

      {results.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-text-muted italic">No symbols found</div>
      ) : (
        <div className="divide-y divide-foreground/6">
          {results.map((r, i) => (
            <div key={i} className="px-2 py-1 flex items-start gap-1.5">
              <span
                className={`text-[10px] font-medium px-1 rounded shrink-0 ${KIND_COLORS[r.kind] ?? "bg-foreground/5 text-text-muted"}`}
              >
                {r.kind}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[11px] font-mono text-blue-500 truncate">{r.path}</span>
                  <span className="text-[10px] text-text-muted shrink-0">L{r.line}</span>
                </div>
                <div className="text-[11px] font-mono text-text-secondary truncate">{r.match}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
