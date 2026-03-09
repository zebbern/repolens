"use client"

import { BarChart3 } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface FileStatsResult {
  path?: string
  lineCount?: number
  language?: string
  importCount?: number
  exportCount?: number
  imports?: string[]
  exports?: string[]
  error?: string
}

export default function FileStatsRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<FileStatsResult>(result)
  if (!data || data.error) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  const fileName = data.path?.split("/").pop() ?? "unknown"

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden max-h-75 overflow-y-auto">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3">
        <BarChart3 className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] font-mono text-text-secondary truncate">{data.path ?? fileName}</span>
      </div>

      <div className="p-2">
        {/* Key stats grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          {data.lineCount != null && (
            <Stat label="Lines" value={data.lineCount.toLocaleString()} />
          )}
          {data.language && (
            <Stat label="Language" value={data.language.toUpperCase()} />
          )}
          {data.importCount != null && (
            <Stat label="Imports" value={String(data.importCount)} />
          )}
          {data.exportCount != null && (
            <Stat label="Exports" value={String(data.exportCount)} />
          )}
        </div>

        {/* Import list preview */}
        {data.imports && data.imports.length > 0 && (
          <div className="mt-1.5">
            <div className="text-[10px] text-text-muted mb-0.5">Imports</div>
            <div className="space-y-px">
              {data.imports.slice(0, 8).map((imp, i) => (
                <div key={i} className="text-[11px] font-mono text-text-muted truncate">{imp}</div>
              ))}
              {data.imports.length > 8 && (
                <div className="text-[10px] text-text-muted">…and {data.imports.length - 8} more</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-text-muted">{label}</span>
      <span className="ml-1.5 text-text-primary font-medium">{value}</span>
    </div>
  )
}
