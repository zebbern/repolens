import React, { useState, useEffect, useMemo, useRef } from "react"
import { Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { buildSearchRegex } from "@/lib/code/code-index"
import type { SearchOptions } from "./types"

interface CodeEditorProps {
  content: string
  language?: string
  highlightedLine?: number
  searchQuery?: string
  searchOptions?: SearchOptions
  onHighlightComplete?: () => void
}

/** Code viewer with line numbers, search highlighting, and copy support. */
const CodeEditor = React.forwardRef<HTMLDivElement, CodeEditorProps>(
  ({ content, language, highlightedLine, searchQuery, searchOptions, onHighlightComplete }, ref) => {
    const [copied, setCopied] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const highlightedRowRef = useRef<HTMLTableRowElement>(null)
    const lines = content.split('\n')

    // Build match-count-per-line map for gutter indicators
    const lineMatchCounts = useMemo(() => {
      const map = new Map<number, number>()
      if (!searchQuery) return map
      const pattern = buildSearchRegex(searchQuery, searchOptions || { caseSensitive: false, regex: false, wholeWord: false })
      if (!pattern) return map
      lines.forEach((line, idx) => {
        pattern.lastIndex = 0
        let count = 0
        while (pattern.exec(line) !== null) {
          count++
          if (pattern.lastIndex === 0) break // zero-length match guard
        }
        if (count > 0) map.set(idx + 1, count)
      })
      return map
    }, [searchQuery, searchOptions, lines])

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

    // Highlight matches in a line - uses shared buildSearchRegex
    const highlightMatches = (line: string, _lineNumber: number) => {
      if (!searchQuery) return line || ' '

      const searchPattern = buildSearchRegex(
        searchQuery,
        searchOptions || { caseSensitive: false, regex: false, wholeWord: false },
        true, // capture group for .split()
      )
      if (!searchPattern) return line || ' '

      const parts = line.split(searchPattern)

      if (parts.length === 1) return line || ' '

      return parts.map((part, i) => {
        searchPattern.lastIndex = 0
        if (searchPattern.test(part)) {
          return <span key={i} className="bg-[#613214] text-[#f8c555]">{part}</span>
        }
        return <span key={i}>{part}</span>
      })
    }

    return (
      <div ref={ref} className="relative h-full">
        {/* Copy Button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-4 h-7 w-7 z-10 bg-[#1a1a1a] hover:bg-[#252525]"
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

                return (
                  <tr
                    key={i}
                    ref={isHighlighted ? highlightedRowRef : undefined}
                    className={cn(
                      "h-5 leading-5",
                      isHighlighted && "bg-[#264f78] animate-pulse"
                    )}
                  >
                    {/* Line Number + Gutter match indicator */}
                    <td className={cn(
                      "sticky left-0 text-text-muted text-right px-3 select-none border-r border-white/[0.06] align-top w-[1%]",
                      isHighlighted ? "bg-[#264f78]" : "bg-[#0a0a0a]"
                    )}>
                      <span className="relative inline-flex items-center">
                        {matchCount && (
                          <span
                            className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-400/80"
                            title={`${matchCount} match${matchCount > 1 ? 'es' : ''} on this line`}
                          />
                        )}
                        {lineNum}
                      </span>
                    </td>
                    {/* Code */}
                    <td className="text-text-primary pl-4 whitespace-pre align-top">
                      {highlightMatches(line, lineNum)}
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
