import { useState } from "react"
import { ChevronRight, ChevronDown, File, Replace } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SearchResult } from "@/lib/code/code-index"
import type { SearchOptions } from "./types"
import { HighlightedText } from "./highlighted-text"
import { ReplacePreview } from "./replace-preview"

interface SearchResultItemProps {
  result: SearchResult
  query: string
  replaceQuery: string
  searchOptions: SearchOptions
  showReplace: boolean
  expandAllMatches: boolean
  onGoTo: (file: string, line: number) => void
  onReplace: (file: string, line: number) => void
  onReplaceAll: (file: string) => void
}

/** A single file's search results in the sidebar. */
export function SearchResultItem({
  result,
  query,
  replaceQuery,
  searchOptions,
  showReplace,
  expandAllMatches,
  onGoTo,
  onReplace,
  onReplaceAll,
}: SearchResultItemProps) {
  const [expanded, setExpanded] = useState(true)
  const [showAllMatches, setShowAllMatches] = useState(false)
  const filename = result.file.split('/').pop()
  const directory = result.file.split('/').slice(0, -1).join('/')

  // Show all matches if expandAllMatches is true or local showAllMatches is true
  const displayAllMatches = expandAllMatches || showAllMatches
  const matchesToShow = displayAllMatches ? result.matches : result.matches.slice(0, 10)
  const remainingMatches = result.matches.length - 10

  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-1 py-1 px-2 rounded hover:bg-white/5 cursor-pointer group"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />
        )}
        <File className="h-4 w-4 shrink-0 text-text-muted" />
        <span className="text-sm text-text-primary truncate">{filename}</span>
        <span className="text-xs text-text-muted truncate ml-1">{directory}</span>
        {showReplace && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onReplaceAll(result.file)
            }}
            title="Replace All in File"
          >
            <Replace className="h-3 w-3" />
          </Button>
        )}
        <span className={cn(
          "text-xs text-text-muted bg-white/10 px-1.5 rounded",
          showReplace ? "" : "ml-auto"
        )}>
          {result.matches.length}
        </span>
      </div>

      {expanded && (
        <div className="ml-6">
          {matchesToShow.map((match, i) => (
            <div
              key={`${match.line}-${i}`}
              className="flex flex-col py-0.5 px-2 rounded hover:bg-white/5 cursor-pointer text-xs group"
              onClick={() => onGoTo(result.file, match.line)}
            >
              <div className="flex items-start gap-2">
                <span className="text-text-muted w-8 text-right shrink-0">{match.line}</span>
                <span className="text-text-secondary truncate flex-1">
                  <HighlightedText text={match.content.trim()} query={query} searchOptions={searchOptions} />
                </span>
                {showReplace && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      onReplace(result.file, match.line)
                    }}
                    title="Replace"
                  >
                    <Replace className="h-2.5 w-2.5" />
                  </Button>
                )}
              </div>
              {/* Replace preview (diff) */}
              {showReplace && (
                <ReplacePreview
                  text={match.content.trim()}
                  query={query}
                  replaceQuery={replaceQuery}
                  searchOptions={searchOptions}
                />
              )}
            </div>
          ))}
          {!displayAllMatches && remainingMatches > 0 && (
            <button
              className="text-xs text-text-muted hover:text-text-secondary px-2 py-1 hover:bg-white/5 rounded w-full text-left"
              onClick={(e) => {
                e.stopPropagation()
                setShowAllMatches(true)
              }}
            >
              +{remainingMatches} more matches (click to expand)
            </button>
          )}
          {displayAllMatches && remainingMatches > 0 && !expandAllMatches && (
            <button
              className="text-xs text-text-muted hover:text-text-secondary px-2 py-1 hover:bg-white/5 rounded w-full text-left"
              onClick={(e) => {
                e.stopPropagation()
                setShowAllMatches(false)
              }}
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  )
}
