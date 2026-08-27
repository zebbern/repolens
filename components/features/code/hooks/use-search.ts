import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import type { FileNode } from "@/types/repository"
import type { CodeIndex, SearchResult } from "@/lib/code/code-index"
import { flattenFiles, validateSearchRegex } from "@/lib/code/code-index"
import { buildSearchPathFilter, matchesSearchPathFilter } from "@/lib/code/search-path-filter"
import { searchInWorker } from "@/lib/code/search-worker-client"
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
}: UseSearchOptions) {
  const [highlightedLine, setHighlightedLine] = useState<{ path: string; line: number } | null>(null)
  const [expandAllMatches, setExpandAllMatches] = useState(false)
  const [visibleResultCount, setVisibleResultCount] = useState(50)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [unsearchedCount, setUnsearchedCount] = useState(0)
  const [unavailableCount, setUnavailableCount] = useState(0)
  const [isSearchTruncated, setIsSearchTruncated] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchWarning, setSearchWarning] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsContainerRef = useRef<HTMLDivElement>(null)

  // Compute search results after resolving metadata-only source from ContentStore.
  useEffect(() => {
    let stale = false
    const controller = new AbortController()
    if (!debouncedSearchQuery.trim() || !isIndexingComplete) {
      queueMicrotask(() => {
        if (!stale) {
          setSearchResults([])
          setUnsearchedCount(0)
          setUnavailableCount(0)
          setIsSearchTruncated(false)
          setSearchError(null)
          setSearchWarning(null)
        }
      })
      return () => {
        stale = true
        controller.abort()
      }
    }

    const regexValidation = searchOptions.regex
      ? validateSearchRegex(debouncedSearchQuery)
      : 'valid'
    const literalFallback = regexValidation !== 'valid'
    const effectiveSearchOptions = literalFallback
      ? { ...searchOptions, regex: false }
      : searchOptions
    const fallbackWarning = regexValidation === 'unsafe'
      ? 'Unsafe regular expression was searched as literal text.'
      : regexValidation === 'invalid'
        ? 'Invalid regular expression was searched as literal text.'
        : null
    queueMicrotask(() => {
      if (!stale) {
        setSearchError(null)
        setSearchWarning(fallbackWarning)
      }
    })
    const pathFilter = buildSearchPathFilter(fileFilter)
    const includesPath = (path: string) => matchesSearchPathFilter(path, pathFilter)

    void searchInWorker(codeIndex, debouncedSearchQuery, {
      ...effectiveSearchOptions,
      ...(pathFilter ? { pathFilter } : {}),
      signal: controller.signal,
    })
      .then(results => {
        if (stale) return
        const filtered: SearchResult[] = pathFilter === undefined
          ? results
          : results.filter(result => includesPath(result.file))
        setSearchResults(filtered)
        setUnsearchedCount((results.unsearchedPaths ?? []).filter(includesPath).length)
        setUnavailableCount((results.unavailablePaths ?? []).filter(includesPath).length)
        setIsSearchTruncated(results.truncated ?? false)
      })
      .catch(error => {
        if (stale) return
        if (error instanceof Error && error.name === 'AbortError') return
        console.warn('[code-search] Worker search failed:', error)
        setSearchResults([])
        setUnsearchedCount(0)
        setUnavailableCount(0)
        setIsSearchTruncated(false)
        setSearchError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      stale = true
      controller.abort()
    }
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
    unavailableCount,
    isSearchTruncated,
    searchError,
    searchWarning,
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
