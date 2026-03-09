"use client"

import { GitBranch } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface ImportsResult {
  path?: string
  imports?: string[]
  importedBy?: string[]
  error?: string
}

export default function ImportsRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<ImportsResult>(result)
  if (!data || data.error) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  const imports = data.imports ?? []
  const importedBy = data.importedBy ?? []

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden max-h-75 overflow-y-auto">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3">
        <GitBranch className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] font-mono text-text-secondary truncate">{data.path}</span>
      </div>

      <div className="p-2 space-y-2">
        {/* Imports from */}
        <div>
          <div className="text-[10px] text-text-muted mb-0.5 flex items-center gap-1">
            Imports from
            <span className="text-text-muted/60">({imports.length})</span>
          </div>
          {imports.length === 0 ? (
            <div className="text-[11px] text-text-muted italic">No imports</div>
          ) : (
            <div className="space-y-px">
              {imports.slice(0, 15).map((imp, i) => (
                <div key={i} className="text-[11px] font-mono text-blue-500 truncate">{imp}</div>
              ))}
              {imports.length > 15 && (
                <div className="text-[10px] text-text-muted">…and {imports.length - 15} more</div>
              )}
            </div>
          )}
        </div>

        {/* Imported by */}
        <div>
          <div className="text-[10px] text-text-muted mb-0.5 flex items-center gap-1">
            Imported by
            <span className="text-text-muted/60">({importedBy.length})</span>
          </div>
          {importedBy.length === 0 ? (
            <div className="text-[11px] text-text-muted italic">No reverse imports found</div>
          ) : (
            <div className="space-y-px">
              {importedBy.slice(0, 15).map((dep, i) => (
                <div key={i} className="text-[11px] font-mono text-green-600 dark:text-green-400 truncate">{dep}</div>
              ))}
              {importedBy.length > 15 && (
                <div className="text-[10px] text-text-muted">…and {importedBy.length - 15} more</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
