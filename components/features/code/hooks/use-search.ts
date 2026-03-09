import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import type { FileNode } from "@/types/repository"
import type { CodeIndex, SearchResult } from "@/lib/code/code-index"
import { searchIndexPartial, flattenFiles } from "@/lib/code/code-index"
import type { SidebarMode, SearchOptions } from "../types"

interface UseSearchOptions {
  codeIndex: CodeIndex
  isIndexingComplete: boolean
  debouncedSearchQuery: string
  searchOptions: SearchOptions
  fileFilter: string
  files: FileNode[]
  openFile: (file: FileNode) => Promise<void>
  sidebarMode: SidebarMode
}

/**
 * Manages search results, go-to-result navigation, highlighted lines,
 * expand/collapse state, and progressive rendering for search results.
 */
export function useSearch({
  codeIndex,
  isIndexingComplete,
  debouncedSearchQuery,
  searchOptions,
  fileFilter,
  files,
  openFile,
  sidebarMode,
}: UseSearchOptions) {
  const [highlightedLine, setHighlightedLine] = useState<{ path: string; line: number } | null>(null)
  const [expandAllMatches, setExpandAllMatches] = useState(false)
  const [visibleResultCount, setVisibleResultCount] = useState(50)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsContainerRef = useRef<HTMLDivElement>(null)

  // Compute search results
  const { searchResults, unsearchedCount } = useMemo(() => {
    if (!debouncedSearchQuery.trim() || !isIndexingComplete) {
      return { searchResults: [] as SearchResult[], unsearchedCount: 0 }
    }

    const partial = searchIndexPartial(codeIndex, debouncedSearchQuery, searchOptions)
    let results = partial.results

    if (fileFilter.trim()) {
      const filters = fileFilter.split(',').map(f => f.trim().toLowerCase()).filter(Boolean)
      results = results.filter(result => {
        const filePath = result.file.toLowerCase()
        return filters.some(filter => {
          if (filter.startsWith('*.')) {
            return filePath.endsWith(filter.slice(1))
          }
          if (filter.endsWith('/*')) {
            return filePath.startsWith(filter.slice(0, -1))
          }
          return filePath.includes(filter)
        })
      })
    }

    return { searchResults: results, unsearchedCount: partial.unsearchedPaths.length }
  }, [debouncedSearchQuery, codeIndex, searchOptions, isIndexingComplete, fileFilter])

  // Go to search result
  const goToSearchResult = useCallback(async (filePath: string, line: number) => {
    const file = flattenFiles(files).find(f => f.path === filePath)
    if (file) {
      await openFile(file)
      setTimeout(() => {
        setHighlightedLine({ path: filePath, line })
      }, 100)
    }
  }, [files, openFile])

  // Total match count
  const totalMatchCount = useMemo(
    () => searchResults.reduce((sum, r) => sum + r.matches.length, 0),
    [searchResults],
  )

  // Progressive rendering: load more results on scroll
  useEffect(() => {
    const container = resultsContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      if (scrollHeight - scrollTop - clientHeight < 200) {
        setVisibleResultCount(prev => Math.min(prev + 50, searchResults.length))
      }
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [searchResults.length])

  // Reset visible count when debounced query changes (handled in main component's debounce effect)

  return {
    searchResults,
    unsearchedCount,
    goToSearchResult,
    highlightedLine,
    setHighlightedLine,
    expandAllMatches,
    setExpandAllMatches,
    visibleResultCount,
    setVisibleResultCount,
    totalMatchCount,
    searchInputRef,
    resultsContainerRef,
  }
}
