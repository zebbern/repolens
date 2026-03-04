import React, { useState, useEffect, useMemo, useRef } from "react"
import { Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { buildSearchRegex } from "@/lib/code/code-index"
import { useSyntaxHighlighting, type SyntaxToken } from "./hooks/use-syntax-highlighting"
import type { SearchOptions } from "./types"
import type { CodeIssue, IssueSeverity } from "@/lib/code/issue-scanner"

interface CodeEditorProps {
  content: string
  language?: string
  highlightedLine?: number
  searchQuery?: string
  searchOptions?: SearchOptions
  onHighlightComplete?: () => void
  /** Scan issues to display as gutter markers */
  issues?: CodeIssue[]
}

/** Map severity to dot colour classes (highest wins when multiple on same line). */
const SEVERITY_DOT_CLASSES: Record<IssueSeverity, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-400',
  info: 'bg-blue-400',
}

const SEVERITY_PRIORITY: Record<IssueSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
}

/** Return the highest-priority severity from a list of issues. */
function getTopSeverity(issues: CodeIssue[]): IssueSeverity {
  let top: IssueSeverity = 'info'
  for (const issue of issues) {
    if (SEVERITY_PRIORITY[issue.severity] > SEVERITY_PRIORITY[top]) {
      top = issue.severity
    }
  }
  return top
}

// ---------------------------------------------------------------------------
// Merge syntax tokens with search-match ranges for a single line.
// Splits syntax tokens at match boundaries so search highlights overlay
// on top of syntax colours without disrupting inline flow.
// ---------------------------------------------------------------------------

interface MatchRange {
  start: number
  end: number
}

function getMatchRanges(line: string, regex: RegExp): MatchRange[] {
  const ranges: MatchRange[] = []
  regex.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(line)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
    if (regex.lastIndex === m.index) regex.lastIndex++ // zero-length guard
  }
  return ranges
}

/** Split syntax tokens at search-match boundaries and tag matched spans. */
function mergeTokensWithMatches(
  tokens: SyntaxToken[],
  matchRanges: MatchRange[],
): { content: string; color?: string; isMatch: boolean }[] {
  if (matchRanges.length === 0) {
    return tokens.map((t) => ({ ...t, isMatch: false }))
  }

  const result: { content: string; color?: string; isMatch: boolean }[] = []
  let charOffset = 0

  for (const token of tokens) {
    const tokenStart = charOffset
    const tokenEnd = charOffset + token.content.length
    let cursor = tokenStart

    for (const range of matchRanges) {
      // Skip ranges entirely before this token
      if (range.end <= cursor) continue
      // Stop if range starts at or after token end
      if (range.start >= tokenEnd) break

      const matchStart = Math.max(range.start, cursor)
      const matchEnd = Math.min(range.end, tokenEnd)

      // Text before the match (within this token)
      if (matchStart > cursor) {
        result.push({
          content: token.content.slice(cursor - tokenStart, matchStart - tokenStart),
          color: token.color,
          isMatch: false,
        })
      }

      // The matched slice
      result.push({
        content: token.content.slice(matchStart - tokenStart, matchEnd - tokenStart),
        color: token.color,
        isMatch: true,
      })

      cursor = matchEnd
    }

    // Remaining text after all matches in this token
    if (cursor < tokenEnd) {
      result.push({
        content: token.content.slice(cursor - tokenStart),
        color: token.color,
        isMatch: false,
      })
    }

    charOffset = tokenEnd
  }

  return result
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Code viewer with syntax highlighting, line numbers, search highlighting, and copy support. */
const CodeEditor = React.forwardRef<HTMLDivElement, CodeEditorProps>(
  ({ content, language, highlightedLine, searchQuery, searchOptions, onHighlightComplete, issues }, ref) => {
    const [copied, setCopied] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const highlightedRowRef = useRef<HTMLTableRowElement>(null)
    const lines = content.split('\n')
    const syntaxLines = useSyntaxHighlighting(content, language)

    // Build per-line issue map for gutter markers
    const issuesByLine = useMemo(() => {
      const map = new Map<number, CodeIssue[]>()
      if (!issues) return map
      for (const issue of issues) {
        const existing = map.get(issue.line) || []
        existing.push(issue)
        map.set(issue.line, existing)
      }
      return map
    }, [issues])

    // Build match-count-per-line map for gutter indicators
    const lineMatchCounts = useMemo(() => {
      const map = new Map<number, number>()
      if (!searchQuery) return map
      const pattern = buildSearchRegex(searchQuery, searchOptions || { caseSensitive: false, regex: false, wholeWord: false })
      if (!pattern) return map
      const splitLines = content.split('\n')
      splitLines.forEach((line, idx) => {
        pattern.lastIndex = 0
        let count = 0
        while (pattern.exec(line) !== null) {
          count++
          if (pattern.lastIndex === 0) break // zero-length match guard
        }
        if (count > 0) map.set(idx + 1, count)
      })
      return map
    }, [searchQuery, searchOptions, content])

    // Pre-compute the search regex once (for merging into tokens)
    const searchRegex = useMemo(() => {
      if (!searchQuery) return null
      return buildSearchRegex(
        searchQuery,
        searchOptions || { caseSensitive: false, regex: false, wholeWord: false },
      )
    }, [searchQuery, searchOptions])

    // Scroll to highlighted line
    useEffect(() => {
      if (highlightedLine) {
        const scrollToLine = () => {
          if (highlightedRowRef.current) {
            highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }

        requestAnimationFrame(() => {
          scrollToLine()
          setTimeout(scrollToLine, 50)
        })

        const timer = setTimeout(() => {
          onHighlightComplete?.()
        }, 2000)

        return () => clearTimeout(timer)
      }
    }, [highlightedLine, onHighlightComplete])

    const handleCopy = async () => {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    /** Render a single line's tokens (syntax-highlighted, with optional search highlights merged in). */
    const renderLine = (lineIndex: number) => {
      const tokens = syntaxLines[lineIndex]
      if (!tokens) return " "

      // If no active search, render syntax tokens directly
      if (!searchRegex) {
        return tokens.map((tok, i) => (
          <span key={i} style={tok.color ? { color: tok.color } : undefined}>
            {tok.content}
          </span>
        ))
      }

      // Merge search matches into the token stream
      const rawLine = lines[lineIndex] ?? ""
      const matchRanges = getMatchRanges(rawLine, searchRegex)
      const merged = mergeTokensWithMatches(tokens, matchRanges)

      return merged.map((tok, i) => (
        <span
          key={i}
          className={tok.isMatch ? "bg-code-highlight-bg text-code-highlight-text" : undefined}
          style={tok.color && !tok.isMatch ? { color: tok.color } : undefined}
        >
          {tok.content}
        </span>
      ))
    }

    return (
      <div ref={ref} className="relative h-full">
        {/* Copy Button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-4 h-7 w-7 z-10 bg-surface hover:bg-surface-elevated"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-status-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>

        <div ref={containerRef} className="h-full text-sm font-mono overflow-auto">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => {
                const lineNum = i + 1
                const isHighlighted = lineNum === highlightedLine
                const matchCount = lineMatchCounts.get(lineNum)
                const lineIssues = issuesByLine.get(lineNum)

                return (
                  <tr
                    key={i}
                    ref={isHighlighted ? highlightedRowRef : undefined}
                    className={cn(
                      "h-5 leading-5",
                      isHighlighted && "bg-code-selection animate-pulse"
                    )}
                  >
                    {/* Line Number + Gutter indicators */}
                    <td className={cn(
                      "sticky left-0 text-text-muted text-right px-3 select-none border-r border-foreground/[0.06] align-top w-[1%]",
                      isHighlighted ? "bg-code-selection" : "bg-background"
                    )}>
                      <span className="relative inline-flex items-center">
                        {/* Search match dot */}
                        {matchCount && !lineIssues && (
                          <span
                            className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-400/80"
                            title={`${matchCount} match${matchCount > 1 ? 'es' : ''} on this line`}
                          />
                        )}
                        {/* Issue severity dot */}
                        {lineIssues && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={cn(
                                    "absolute -left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full cursor-pointer",
                                    SEVERITY_DOT_CLASSES[getTopSeverity(lineIssues)],
                                  )}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-xs">
                                <ul className="space-y-1">
                                  {lineIssues.map((issue) => (
                                    <li key={issue.id} className="text-xs">
                                      <span className={cn(
                                        "font-medium",
                                        issue.severity === 'critical' && "text-red-400",
                                        issue.severity === 'warning' && "text-amber-400",
                                        issue.severity === 'info' && "text-blue-400",
                                      )}>
                                        [{issue.severity}]
                                      </span>{' '}
                                      {issue.title}
                                    </li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {lineNum}
                      </span>
                    </td>
                    {/* Code */}
                    <td className="text-text-primary pl-4 whitespace-pre align-top">
                      {renderLine(i)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }
)
CodeEditor.displayName = "CodeEditor"

export { CodeEditor }
export type { CodeEditorProps }
