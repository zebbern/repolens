"use client"

import { useState } from "react"
import { FileText, ChevronDown, ChevronRight } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface ReadFileResult {
  path?: string
  content?: string
  lineCount?: number
  totalLines?: number
  startLine?: number
  endLine?: number
  warning?: string
  error?: string
}

const COLLAPSED_LINE_COUNT = 15
const MAX_LINE_COUNT = 20

export default function ReadFileRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<ReadFileResult>(result)
  if (!data || data.error) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  const { path, content, totalLines, startLine, warning } = data
  const fileName = path?.split("/").pop() ?? "unknown"
  const ext = fileName.split(".").pop() ?? ""

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3">
        <FileText className="h-3 w-3 shrink-0 text-text-muted" />
        <span className="text-[11px] font-mono text-text-secondary truncate">{path}</span>
        <span className="ml-auto text-[10px] text-text-muted shrink-0">
          {ext && <span className="uppercase">{ext}</span>}
          {totalLines != null && <span className="ml-1">· {totalLines} lines</span>}
        </span>
      </div>

      {warning && (
        <div className="px-2 py-0.5 text-[10px] text-amber-600 bg-amber-500/10 border-b border-foreground/6">
          {warning}
        </div>
      )}

      {/* Code */}
      {content != null && (
        <CodeBlock content={content} startLine={startLine ?? 1} />
      )}
    </div>
  )
}

function CodeBlock({ content, startLine }: { content: string; startLine: number }) {
  const lines = content.split("\n")
  const needsCollapse = lines.length > MAX_LINE_COUNT
  const [expanded, setExpanded] = useState(!needsCollapse)

  const visibleLines = expanded ? lines : lines.slice(0, COLLAPSED_LINE_COUNT)

  return (
    <div className="max-h-75 overflow-y-auto overflow-x-auto">
      <pre className="text-[11px] leading-relaxed font-mono text-text-secondary">
        <code>
          {visibleLines.map((line, i) => (
            <div key={i} className="flex hover:bg-foreground/3 px-1">
              <span className="inline-block w-8 shrink-0 text-right pr-2 text-text-muted select-none">
                {startLine + i}
              </span>
              <span className="whitespace-pre wrap-break-word">{line}</span>
            </div>
          ))}
        </code>
      </pre>
      {needsCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-2 py-1 text-[10px] text-blue-500 hover:bg-foreground/3 border-t border-foreground/6"
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3 w-3" /> Show less
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" /> Show all {lines.length} lines
            </>
          )}
        </button>
      )}
    </div>
  )
}
