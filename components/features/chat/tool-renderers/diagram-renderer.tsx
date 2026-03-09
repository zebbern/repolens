"use client"

import { useState, lazy, Suspense } from "react"
import { Shapes, Code2 } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"
import type { MermaidDiagramHandle } from "@/components/features/diagrams/mermaid-diagram"
import { useRef } from "react"

const LazyMermaidDiagram = lazy(() =>
  import("@/components/features/diagrams/mermaid-diagram").then((m) => ({
    default: m.MermaidDiagram,
  })),
)

interface DiagramResult {
  type?: string
  mermaid?: string
  fileCount?: number
  nodeCount?: number
  edgeCount?: number
  totalEdges?: number
  error?: string
}

export default function DiagramRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<DiagramResult>(result)
  const mermaidRef = useRef<MermaidDiagramHandle>(null)
  const [showCode, setShowCode] = useState(false)

  if (!data || data.error || !data.mermaid) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "No diagram data"}
      </div>
    )
  }

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3">
        <Shapes className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] text-text-secondary capitalize">{data.type} diagram</span>
        {data.fileCount != null && (
          <span className="text-[10px] text-text-muted">· {data.fileCount} files</span>
        )}
        {data.nodeCount != null && (
          <span className="text-[10px] text-text-muted">· {data.nodeCount} nodes</span>
        )}
        <button
          onClick={() => setShowCode(!showCode)}
          className="ml-auto text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-0.5"
        >
          <Code2 className="h-3 w-3" />
          {showCode ? "Diagram" : "Code"}
        </button>
      </div>

      {showCode ? (
        <pre className="p-2 text-[11px] font-mono text-text-secondary whitespace-pre-wrap max-h-62.5 overflow-y-auto">
          {data.mermaid}
        </pre>
      ) : (
        <div className="max-h-62.5 overflow-auto p-2">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-20 text-[11px] text-text-muted">
                Loading diagram…
              </div>
            }
          >
            <LazyMermaidDiagram ref={mermaidRef} chart={data.mermaid} className="min-h-25" />
          </Suspense>
        </div>
      )}
    </div>
  )
}
