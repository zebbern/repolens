"use client"

import { useState } from "react"
import { FileText, ChevronDown, ChevronRight } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface FileEntry {
  path?: string
  content?: string
  lineCount?: number
  totalLines?: number
  warning?: string
  error?: string
}

interface ReadFilesResult {
  files?: FileEntry[]
  error?: string
}

export default function ReadFilesRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<ReadFilesResult>(result)
  if (!data || data.error || !data.files) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  return (
    <div className="space-y-1 max-h-75 overflow-y-auto">
      {data.files.map((file, i) => (
        <MiniFileCard key={i} file={file} />
      ))}
    </div>
  )
}

function MiniFileCard({ file }: { file: FileEntry }) {
  const [expanded, setExpanded] = useState(false)
  const fileName = file.path?.split("/").pop() ?? "unknown"

  if (file.error) {
    return (
      <div className="rounded border border-red-500/20 bg-red-500/5 px-2 py-1 text-[11px] font-mono text-red-500">
        {file.error}
      </div>
    )
  }

  const lines = file.content?.split("\n") ?? []
  const previewLines = lines.slice(0, 8)

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-foreground/3"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
        )}
        <FileText className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] font-mono text-text-secondary truncate">{file.path ?? fileName}</span>
        <span className="ml-auto text-[10px] text-text-muted shrink-0">
          {file.totalLines ?? lines.length} lines
        </span>
      </button>
      {expanded && file.content != null && (
        <pre className="px-2 py-1 border-t border-foreground/6 max-h-50 overflow-y-auto text-[11px] font-mono text-text-secondary whitespace-pre wrap-break-word">
          {file.content}
        </pre>
      )}
      {!expanded && file.content != null && (
        <pre className="px-2 py-1 border-t border-foreground/6 text-[11px] font-mono text-text-muted whitespace-pre wrap-break-word">
          {previewLines.join("\n")}
          {lines.length > 8 && "\n…"}
        </pre>
      )}
    </div>
  )
}
