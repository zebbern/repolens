"use client"

import { useRef, useMemo, useCallback, memo } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { expandBlameRanges, type BlameAuthorStats, type BlameLineInfo } from "@/lib/git-history"
import type { BlameData } from "@/types/git-history"
import { AuthorAvatar, CommitMessage, AgeIndicator, RelativeDate, ageToColor } from "./git-history-helpers"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const ROW_HEIGHT = 20
const OVERSCAN = 20

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BlameViewData {
  blameData: BlameData
  filePath: string
  fileContent: string
  blameStats: BlameAuthorStats[]
}

interface BlameViewProps {
  data: BlameViewData
  onCommitClick: (sha: string) => void
}

// ---------------------------------------------------------------------------
// BlameView
// ---------------------------------------------------------------------------

export function BlameView({
  data,
  onCommitClick,
}: BlameViewProps) {
  const { blameData, filePath, fileContent, blameStats } = data
  const lines = useMemo(() => fileContent.split('\n'), [fileContent])
  const blameLines = useMemo(
    () => expandBlameRanges(blameData.ranges),
    [blameData.ranges],
  )

  // Build a lookup map for fast line access
  const blameByLine = useMemo(() => {
    const map = new Map<number, BlameLineInfo>()
    for (const info of blameLines) {
      map.set(info.lineNumber, info)
    }
    return map
  }, [blameLines])

  const scrollRef = useRef<HTMLDivElement>(null)

  const estimateSize = useCallback(() => ROW_HEIGHT, [])

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: OVERSCAN,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // Spacer heights for the table approach
  const topPad = virtualItems.length > 0 ? virtualItems[0].start : 0
  const bottomPad = virtualItems.length > 0
    ? totalSize - virtualItems[virtualItems.length - 1].end
    : 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Stats summary */}
      {blameStats.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground shrink-0">
          <span className="font-medium text-foreground mr-1">
            {filePath.split('/').pop()}
          </span>
          <span className="text-muted-foreground">—</span>
          {blameStats.slice(0, 5).map((stat) => (
            <span key={stat.email} className="flex items-center gap-1">
              <AuthorAvatar
                login={stat.login}
                avatarUrl={stat.avatarUrl}
                name={stat.name}
                size={16}
              />
              <span>{stat.name}</span>
              <span className="text-muted-foreground">({stat.percentage}%)</span>
            </span>
          ))}
          {blameStats.length > 5 && (
            <span className="text-muted-foreground">
              +{blameStats.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Blame gutter + code lines (virtualized) */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <TooltipProvider>
          <table className="w-full border-collapse text-xs font-mono">
            <thead className="sr-only">
              <tr>
                <th scope="col">Age</th>
                <th scope="col">Author & Commit</th>
                <th scope="col">Line</th>
                <th scope="col">Code</th>
              </tr>
            </thead>
            <tbody>
              {topPad > 0 && (
                <tr aria-hidden="true"><td colSpan={4} style={{ height: topPad, padding: 0 }} /></tr>
              )}
              {virtualItems.map((virtualRow) => {
                const idx = virtualRow.index
                const lineNum = idx + 1
                const info = blameByLine.get(lineNum)
                return (
                  <BlameRow
                    key={lineNum}
                    lineNumber={lineNum}
                    content={lines[idx]}
                    blameInfo={info ?? null}
                    onCommitClick={onCommitClick}
                  />
                )
              })}
              {bottomPad > 0 && (
                <tr aria-hidden="true"><td colSpan={4} style={{ height: bottomPad, padding: 0 }} /></tr>
              )}
            </tbody>
          </table>
        </TooltipProvider>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BlameRow — single line with gutter annotation
// ---------------------------------------------------------------------------

interface BlameRowProps {
  lineNumber: number
  content: string
  blameInfo: BlameLineInfo | null
  onCommitClick: (sha: string) => void
}

const BlameRow = memo(function BlameRow({ lineNumber, content, blameInfo, onCommitClick }: BlameRowProps) {
  const isRangeStart = blameInfo?.isRangeStart ?? false
  const commit = blameInfo?.commit
  const age = blameInfo?.age ?? 5

  return (
    <tr className="group hover:bg-muted/40 leading-5">
      {/* Age indicator */}
      <td className="w-1 p-0">
        {blameInfo && (
          <div
            className="w-1 h-full min-h-[20px]"
            style={{ backgroundColor: ageToColor(age), opacity: isRangeStart ? 1 : 0.4 }}
          />
        )}
      </td>

      {/* Blame annotation gutter */}
      <td className="w-[220px] min-w-[220px] max-w-[220px] border-r px-2 py-0 align-top select-none">
        {isRangeStart && commit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 text-left text-muted-foreground hover:text-foreground transition-colors truncate py-0.5"
                onClick={() => onCommitClick(commit.oid)}
              >
                <AuthorAvatar
                  login={commit.author?.user?.login ?? null}
                  avatarUrl={commit.author?.user?.avatarUrl ?? null}
                  name={commit.author?.name ?? 'Unknown'}
                  size={16}
                />
                <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                  {commit.abbreviatedOid}
                </span>
                <span className="truncate flex-1">
                  {commit.messageHeadline}
                </span>
                <RelativeDate date={commit.committedDate} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-sm">
              <div className="space-y-1">
                <p className="font-semibold">{commit.messageHeadline}</p>
                {commit.message !== commit.messageHeadline && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {commit.message.slice(commit.messageHeadline.length).trim()}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {commit.author?.name ?? 'Unknown'} · {new Date(commit.committedDate).toLocaleDateString()}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="h-5" />
        )}
      </td>

      {/* Line number */}
      <td className="w-12 px-2 py-0 text-right text-muted-foreground/50 select-none align-top">
        {lineNumber}
      </td>

      {/* Code content */}
      <td className="px-3 py-0 whitespace-pre align-top">
        {content || '\u00A0'}
      </td>
    </tr>
  )
})
