"use client"

import { Folder, FileText } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface ListDirectoryResult {
  directory?: string
  entries?: string[]
  error?: string
}

export default function ListDirectoryRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<ListDirectoryResult>(result)
  if (!data || data.error) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  const entries = data.entries ?? []

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden max-h-75 overflow-y-auto">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3">
        <Folder className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] font-mono text-text-secondary truncate">
          {data.directory ?? "(root)"}
        </span>
        <span className="ml-auto text-[10px] text-text-muted shrink-0">
          {entries.length} items
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-text-muted italic">Empty directory</div>
      ) : (
        <ul className="py-0.5">
          {entries.map((entry, i) => {
            const isDir = entry.endsWith("/")
            const name = isDir ? entry.slice(0, -1) : entry
            return (
              <li key={i} className="flex items-center gap-1.5 px-2 py-px hover:bg-foreground/3">
                {isDir ? (
                  <Folder className="h-3 w-3 text-blue-500 shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 text-text-muted shrink-0" />
                )}
                <span className={`text-[11px] font-mono ${isDir ? "text-blue-500" : "text-text-secondary"}`}>
                  {name}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
