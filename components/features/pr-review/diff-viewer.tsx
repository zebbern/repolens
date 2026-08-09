"use client"

import { useMemo } from "react"
import { FileCode } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { PRFile } from "@/types/pr-review"
import { parsePatch } from "@/lib/git-history"
import type { DiffHunk, DiffLine } from "@/lib/git-history/types"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DiffViewerProps {
  file: PRFile
}

// ---------------------------------------------------------------------------
// DiffViewer
// ---------------------------------------------------------------------------

export function DiffViewer({ file }: DiffViewerProps) {
  const parsed = useMemo(() => parsePatch(file.patch), [file.patch])

  return (
    <div className="flex h-full flex-col">
      {/* File header */}
      <div className="shrink-0 flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
        <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-mono truncate">{file.filename}</span>
        {file.previousFilename && (
          <span className="text-xs text-muted-foreground">← {file.previousFilename}</span>
        )}
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-xs font-mono shrink-0">
          <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
          <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
        </span>
      </div>

      {/* Diff content */}
      <ScrollArea className="flex-1">
        {parsed.isBinary ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground italic">
            Binary file changed
          </div>
        ) : parsed.hunks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground italic">
            No diff available
          </div>
        ) : (
          <table className="w-full border-collapse text-xs font-mono">
            <thead className="sr-only">
              <tr>
                <th scope="col">Old line</th>
                <th scope="col">New line</th>
                <th scope="col">Code</th>
              </tr>
            </thead>
            <tbody>
              {parsed.hunks.map((hunk, hunkIdx) => (
                <HunkSection key={hunkIdx} hunk={hunk} />
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HunkSection
// ---------------------------------------------------------------------------

function HunkSection({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      {/* Hunk header */}
      <tr>
        <td
          colSpan={3}
          className="bg-blue-500/10 text-blue-600 dark:text-blue-400 px-4 py-1 font-mono text-xs select-none"
        >
          {hunk.header}
        </td>
      </tr>

      {/* Diff lines */}
      {hunk.lines.map((line, lineIdx) => (
        <DiffLine key={lineIdx} line={line} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// DiffLine
// ---------------------------------------------------------------------------

function DiffLine({ line }: { line: DiffLine }) {
  const bgClass =
    line.type === "add"
      ? "bg-green-500/15"
      : line.type === "remove"
        ? "bg-red-500/15"
        : ""

  const textClass =
    line.type === "add"
      ? "text-green-700 dark:text-green-400"
      : line.type === "remove"
        ? "text-red-700 dark:text-red-400"
        : "text-foreground"

  const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " "

  return (
    <tr className={bgClass}>
      <td className="w-12 px-2 py-0 text-right text-muted-foreground/50 select-none align-top leading-5 border-r border-border/30">
        {line.oldLineNumber ?? ""}
      </td>
      <td className="w-12 px-2 py-0 text-right text-muted-foreground/50 select-none align-top leading-5 border-r border-border/30">
        {line.newLineNumber ?? ""}
      </td>
      <td className={`px-3 py-0 whitespace-pre leading-5 ${textClass}`}>
        {prefix}
        {line.content}
      </td>
    </tr>
  )
}
