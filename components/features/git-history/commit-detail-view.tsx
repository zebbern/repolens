"use client"

import { useState, useMemo } from "react"
import { ChevronLeft, ChevronDown, ChevronRight, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { CommitDetail, CommitFile } from "@/types/git-history"
import { parsePatch, type DiffHunk, type DiffLine } from "@/lib/git-history"
import { AuthorAvatar, DiffStats, FileStatusBadge } from "./git-history-helpers"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CommitDetailViewProps {
  commit: CommitDetail
  onBack: () => void
  onFileClick?: (path: string) => void
}

// ---------------------------------------------------------------------------
// CommitDetailView
// ---------------------------------------------------------------------------

export function CommitDetailView({ commit, onBack, onFileClick }: CommitDetailViewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const headline = commit.message.split('\n')[0]
  const body = commit.message.slice(headline.length).trim()

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(filename)) {
        next.delete(filename)
      } else {
        next.add(filename)
      }
      return next
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        </div>

        {/* Commit message */}
        <div>
          <h2 className="text-base font-semibold leading-snug">{headline}</h2>
          {body && (
            <pre className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap font-sans">
              {body}
            </pre>
          )}
        </div>

        {/* Author & meta */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <AuthorAvatar
            login={commit.authorLogin}
            avatarUrl={commit.authorAvatarUrl}
            name={commit.authorName}
            size={20}
          />
          <span className="font-medium">{commit.authorName}</span>
          <span className="text-muted-foreground">
            {new Date(commit.authorDate).toLocaleString()}
          </span>
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
            {commit.sha.slice(0, 7)}
          </code>
          {commit.parents.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {commit.parents.length} parent{commit.parents.length !== 1 ? 's' : ''}
            </span>
          )}
          {commit.url && (
            <a
              href={commit.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Stats summary */}
        <div className="flex items-center gap-3 text-sm">
          <DiffStats additions={commit.stats.additions} deletions={commit.stats.deletions} />
          <span className="text-muted-foreground">
            {commit.files.length} file{commit.files.length !== 1 ? 's' : ''} changed
          </span>
        </div>
      </div>

      {/* File list with diffs */}
      <div className="flex-1 overflow-auto">
        {commit.files.map((file) => (
          <CommitFileSection
            key={file.filename}
            file={file}
            isExpanded={expandedFiles.has(file.filename)}
            onToggle={() => toggleFile(file.filename)}
            onFileClick={onFileClick}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommitFileSection — single file with collapsible diff
// ---------------------------------------------------------------------------

interface CommitFileSectionProps {
  file: CommitFile
  isExpanded: boolean
  onToggle: () => void
  onFileClick?: (path: string) => void
}

function CommitFileSection({ file, isExpanded, onToggle, onFileClick }: CommitFileSectionProps) {
  const parsed = useMemo(() => parsePatch(file.patch), [file.patch])

  return (
    <div className="border-b">
      {/* File header */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-muted/40 transition-colors text-left"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <FileStatusBadge status={file.status} />
        <span
          className="flex-1 truncate font-mono text-xs cursor-pointer"
          onClick={(e) => {
            if (onFileClick) {
              e.stopPropagation()
              onFileClick(file.filename)
            }
          }}
        >
          {file.filename}
          {file.previousFilename && (
            <span className="text-muted-foreground"> ← {file.previousFilename}</span>
          )}
        </span>
        <DiffStats additions={file.additions} deletions={file.deletions} />
      </button>

      {/* Diff content */}
      {isExpanded && (
        <div className="bg-muted/20">
          {parsed.isBinary ? (
            <div className="px-4 py-3 text-xs text-muted-foreground italic">
              Binary file changed
            </div>
          ) : parsed.hunks.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground italic">
              No diff available
            </div>
          ) : (
            <DiffContent hunks={parsed.hunks} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DiffContent — rendered diff hunks
// ---------------------------------------------------------------------------

interface DiffContentProps {
  hunks: DiffHunk[]
}

function DiffContent({ hunks }: DiffContentProps) {
  return (
    <table className="w-full border-collapse text-xs font-mono">
      <tbody>
        {hunks.map((hunk, hunkIdx) => (
          <HunkSection key={hunkIdx} hunk={hunk} />
        ))}
      </tbody>
    </table>
  )
}

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
        <DiffLineRow key={lineIdx} line={line} />
      ))}
    </>
  )
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const bgClass =
    line.type === 'add'
      ? 'bg-green-500/10'
      : line.type === 'remove'
        ? 'bg-red-500/10'
        : ''

  const textClass =
    line.type === 'add'
      ? 'text-green-700 dark:text-green-400'
      : line.type === 'remove'
        ? 'text-red-700 dark:text-red-400'
        : 'text-foreground'

  const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '

  return (
    <tr className={bgClass}>
      <td className="w-12 px-2 py-0 text-right text-muted-foreground/50 select-none align-top leading-5 border-r border-border/30">
        {line.oldLineNumber ?? ''}
      </td>
      <td className="w-12 px-2 py-0 text-right text-muted-foreground/50 select-none align-top leading-5 border-r border-border/30">
        {line.newLineNumber ?? ''}
      </td>
      <td className={`px-3 py-0 whitespace-pre leading-5 ${textClass}`}>
        {prefix}{line.content}
      </td>
    </tr>
  )
}
