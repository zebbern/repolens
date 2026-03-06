"use client"

import { useRef, useEffect, useState, useMemo, useCallback } from "react"
import {
  Search, Code2, FileText, Braces, Box, Shapes, Type, List, Code,
  CaseSensitive, WholeWord, Regex, X, ChevronRight, ChevronDown,
  Filter, FilterX,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CodeIndex, SearchResult, SearchMatch } from "@/lib/code/code-index"
import { searchIndex, buildSearchRegex } from "@/lib/code/code-index"
import { extractSymbols, type ExtractedSymbol } from "@/components/features/code/hooks/use-symbol-extraction"

/* ── Types ─────────────────────────────────────────────────────────── */

type SearchTab = 'files' | 'code' | 'symbols'

type SymbolKind = ExtractedSymbol['kind']

interface FileResult {
  path: string
  name: string
  lineCount: number
}

interface SymbolResult {
  symbol: ExtractedSymbol
  filePath: string
  fileName: string
}

interface GlobalSearchOverlayProps {
  codeIndex: CodeIndex
  allFiles: FileResult[]
  onSelect: (path: string, line?: number) => void
  onClose: () => void
}

/* ── Constants ─────────────────────────────────────────────────────── */

const INITIAL_VISIBLE_COUNT = 100
const VISIBLE_COUNT_INCREMENT = 100

const GENERATED_FILE_PATTERNS = [
  /pnpm-lock\.yaml$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /\.lock$/,
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /dist\//,
  /\.next\//,
  /node_modules\//,
  /\.map$/,
]

const SYMBOL_ICON_MAP: Record<SymbolKind, React.ElementType> = {
  function: Braces,
  class: Box,
  interface: Shapes,
  type: Type,
  enum: List,
  variable: Code,
  method: Braces,
  property: Code,
}

const SYMBOL_KIND_COLORS: Record<SymbolKind, string> = {
  function: 'text-blue-400',
  class: 'text-amber-400',
  interface: 'text-green-400',
  type: 'text-purple-400',
  enum: 'text-orange-400',
  variable: 'text-cyan-400',
  method: 'text-blue-300',
  property: 'text-cyan-300',
}

const SYMBOL_KIND_LABELS: Record<SymbolKind, string> = {
  function: 'fn',
  class: 'cls',
  interface: 'ifc',
  type: 'typ',
  enum: 'enm',
  variable: 'var',
  method: 'met',
  property: 'prp',
}

const FILTERABLE_SYMBOL_KINDS: SymbolKind[] = [
  'function', 'class', 'interface', 'type', 'enum', 'variable',
]

/* ── Hooks ─────────────────────────────────────────────────────────── */

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/* ── Sub-components ────────────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  shortcut,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  label: string
  shortcut: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md transition-colors",
        active
          ? "bg-foreground/10 text-text-primary"
          : "text-text-muted hover:text-text-secondary hover:bg-foreground/5"
      )}
      title={`${label} (Ctrl+${shortcut})`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  )
}

function SearchToggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center h-6 w-6 rounded transition-colors",
        active
          ? "bg-foreground/15 text-text-primary"
          : "text-text-muted hover:text-text-secondary hover:bg-foreground/5"
      )}
      title={label}
      aria-pressed={active}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

function HighlightedText({ text, query, options }: {
  text: string
  query: string
  options: { caseSensitive: boolean; regex: boolean; wholeWord: boolean }
}) {
  if (!query.trim()) return <>{text}</>
  const rx = buildSearchRegex(query, options, true)
  if (!rx) return <>{text}</>
  const parts = text.split(rx)
  return (
    <>
      {parts.map((part, i) => {
        // Odd-index parts are the captured matches
        if (i % 2 === 1) {
          return <mark key={i} className="bg-yellow-400/30 text-text-primary rounded-sm px-px">{part}</mark>
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

/* ── Main Component ────────────────────────────────────────────────── */

export function GlobalSearchOverlay({
  codeIndex,
  allFiles,
  onSelect,
  onClose,
}: GlobalSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const [activeTab, setActiveTab] = useState<SearchTab>('files')
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebouncedValue(query, activeTab === 'files' ? 0 : 300)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Code search options
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [excludeGenerated, setExcludeGenerated] = useState(true)
  const codeSearchOptions = useMemo(
    () => ({ caseSensitive, regex: useRegex, wholeWord }),
    [caseSensitive, useRegex, wholeWord],
  )

  // Symbol kind filters
  const [activeKinds, setActiveKinds] = useState<Set<SymbolKind>>(
    () => new Set(FILTERABLE_SYMBOL_KINDS),
  )

  const toggleKind = useCallback((kind: SymbolKind) => {
    setActiveKinds(prev => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [activeTab])

  // Collapsible file groups (code tab)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const [codeVisibleCount, setCodeVisibleCount] = useState(INITIAL_VISIBLE_COUNT)

  const toggleFileCollapse = useCallback((file: string) => {
    setCollapsedFiles(prev => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }, [])

  const loadMoreCodeResults = useCallback(() => {
    setCodeVisibleCount(prev => prev + VISIBLE_COUNT_INCREMENT)
  }, [])

  // Reset selected index when query or tab changes
  useEffect(() => {
    setSelectedIndex(0)
    setCollapsedFiles(new Set())
    setCodeVisibleCount(INITIAL_VISIBLE_COUNT)
  }, [debouncedQuery, activeTab])

  /* ── File search ──────────────────────────────────────────────── */

  const fileResults = useMemo(() => {
    if (activeTab !== 'files' || !query.trim()) return []
    const q = query.toLowerCase()
    return allFiles
      .filter(f => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      .slice(0, 50)
  }, [query, allFiles, activeTab])

  /* ── Code search ──────────────────────────────────────────────── */

  const { codeResults, totalCodeMatches } = useMemo(() => {
    if (activeTab !== 'code' || !debouncedQuery.trim()) return { codeResults: [], totalCodeMatches: 0 }
    const results = searchIndex(codeIndex, debouncedQuery, codeSearchOptions)
    const filtered = excludeGenerated
      ? results.filter(r => !GENERATED_FILE_PATTERNS.some(p => p.test(r.file)))
      : results
    const items: Array<{ file: string; match: SearchMatch; language?: string }> = []
    let total = 0
    for (const result of filtered) {
      total += result.matches.length
      for (const match of result.matches) {
        items.push({ file: result.file, match, language: result.language })
      }
    }
    return { codeResults: items, totalCodeMatches: total }
  }, [debouncedQuery, codeIndex, codeSearchOptions, activeTab, excludeGenerated])

  // Visible code results: exclude collapsed files, limit by visibleCount
  const visibleCodeItems = useMemo(() => {
    const items: typeof codeResults = []
    for (const r of codeResults) {
      if (collapsedFiles.has(r.file)) continue
      items.push(r)
      if (items.length >= codeVisibleCount) break
    }
    return items
  }, [codeResults, collapsedFiles, codeVisibleCount])

  const hasMoreCodeResults = useMemo(() => {
    let count = 0
    for (const r of codeResults) {
      if (collapsedFiles.has(r.file)) continue
      count++
      if (count > codeVisibleCount) return true
    }
    return false
  }, [codeResults, collapsedFiles, codeVisibleCount])

  const codeResultStats = useMemo(() => {
    if (activeTab !== 'code' || !debouncedQuery.trim() || codeResults.length === 0) return null
    const fileCount = new Set(codeResults.map(r => r.file)).size
    return { totalMatches: totalCodeMatches, fileCount, visibleCount: visibleCodeItems.length }
  }, [debouncedQuery, codeResults, activeTab, totalCodeMatches, visibleCodeItems.length])

  /* ── Symbol search ────────────────────────────────────────────── */

  // Build cross-file symbol index (cached via useMemo on codeIndex reference)
  const allSymbols = useMemo(() => {
    if (activeTab !== 'symbols') return []
    const result: SymbolResult[] = []
    for (const [, file] of codeIndex.files) {
      const symbols = extractSymbols(file.content, file.language)
      for (const symbol of symbols) {
        result.push({ symbol, filePath: file.path, fileName: file.name })
        // Include children (methods, properties)
        if (symbol.children) {
          for (const child of symbol.children) {
            result.push({ symbol: child, filePath: file.path, fileName: file.name })
          }
        }
      }
    }
    return result
  }, [codeIndex, activeTab])

  const symbolResults = useMemo(() => {
    if (activeTab !== 'symbols') return []
    const q = debouncedQuery.toLowerCase().trim()
    return allSymbols
      .filter(s => {
        if (!activeKinds.has(s.symbol.kind)) return false
        if (!q) return true
        return s.symbol.name.toLowerCase().includes(q)
      })
      .slice(0, INITIAL_VISIBLE_COUNT)
  }, [debouncedQuery, allSymbols, activeKinds, activeTab])

  /* ── Navigable items ──────────────────────────────────────────── */

  const itemCount = activeTab === 'files'
    ? fileResults.length
    : activeTab === 'code'
      ? visibleCodeItems.length
      : symbolResults.length

  // Clamp selectedIndex when itemCount shrinks (e.g. file collapse)
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, itemCount - 1)))
  }, [itemCount])

  const selectItem = useCallback((index: number) => {
    if (activeTab === 'files') {
      const result = fileResults[index]
      if (result) onSelect(result.path)
    } else if (activeTab === 'code') {
      const result = visibleCodeItems[index]
      if (result) onSelect(result.file, result.match.line)
    } else {
      const result = symbolResults[index]
      if (result) onSelect(result.filePath, result.symbol.line)
    }
  }, [activeTab, fileResults, visibleCodeItems, symbolResults, onSelect])

  /* ── Keyboard ─────────────────────────────────────────────────── */

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (itemCount === 0) return
      setSelectedIndex(prev => Math.min(prev + 1, itemCount - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      selectItem(selectedIndex)
      return
    }
    // Tab switching: Ctrl+1/2/3
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '1') { e.preventDefault(); setActiveTab('files') }
      if (e.key === '2') { e.preventDefault(); setActiveTab('code') }
      if (e.key === '3') { e.preventDefault(); setActiveTab('symbols') }
    }

  }, [onClose, itemCount, selectedIndex, selectItem, activeTab])

  // Scroll selected item into view
  useEffect(() => {
    const container = resultsRef.current
    if (!container) return
    const item = container.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null
    if (item) item.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  /* ── Placeholder text ─────────────────────────────────────────── */

  const placeholder = activeTab === 'files'
    ? 'Search files by name or path...'
    : activeTab === 'code'
      ? 'Search in file contents...'
      : 'Search for symbols...'

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-[12%]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-popover border border-foreground/10 rounded-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1">
          <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={FileText} label="Find Files" shortcut="1" />
          <TabButton active={activeTab === 'code'} onClick={() => setActiveTab('code')} icon={Search} label="Code Search" shortcut="2" />
          <TabButton active={activeTab === 'symbols'} onClick={() => setActiveTab('symbols')} icon={Braces} label="Symbols" shortcut="3" />
          <div className="flex-1" />
          <kbd className="text-[10px] text-text-muted/50 bg-foreground/[0.04] px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* Search input row */}
        <div className="flex items-center gap-2 px-3 border-b border-foreground/[0.06]">
          <Search className="h-4 w-4 text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 h-10 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            role="combobox"
            aria-label="Search"
            aria-expanded={itemCount > 0}
            aria-controls="search-results"
            aria-activedescendant={itemCount > 0 ? `search-result-${selectedIndex}` : undefined}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="flex items-center justify-center h-5 w-5 rounded-sm hover:bg-foreground/10 text-text-muted"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Code search option toggles */}
          {activeTab === 'code' && (
            <div className="flex items-center gap-0.5 ml-1">
              <SearchToggle active={caseSensitive} onClick={() => setCaseSensitive(v => !v)} icon={CaseSensitive} label="Match Case" />
              <SearchToggle active={wholeWord} onClick={() => setWholeWord(v => !v)} icon={WholeWord} label="Whole Word" />
              <SearchToggle active={useRegex} onClick={() => setUseRegex(v => !v)} icon={Regex} label="Use Regex" />
              <div className="w-px h-4 bg-foreground/10 mx-0.5" />
              <SearchToggle active={excludeGenerated} onClick={() => setExcludeGenerated(v => !v)} icon={excludeGenerated ? FilterX : Filter} label={excludeGenerated ? 'Excluding generated files' : 'Including generated files'} />
            </div>
          )}
        </div>

        {/* Symbol kind filter row */}
        {activeTab === 'symbols' && (
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-foreground/[0.04]">
            {FILTERABLE_SYMBOL_KINDS.map(kind => {
              const Icon = SYMBOL_ICON_MAP[kind]
              const isActive = activeKinds.has(kind)
              return (
                <button
                  key={kind}
                  onClick={() => toggleKind(kind)}
                  className={cn(
                    "inline-flex items-center gap-0.5 h-5 px-1.5 rounded text-[10px] transition-colors border",
                    isActive
                      ? "border-foreground/15 bg-foreground/5 text-text-secondary"
                      : "border-transparent bg-transparent text-text-muted opacity-40 hover:opacity-70",
                  )}
                  title={`${isActive ? 'Hide' : 'Show'} ${kind}s`}
                >
                  <Icon className={cn("h-3 w-3 shrink-0", isActive ? SYMBOL_KIND_COLORS[kind] : "text-text-muted")} />
                  <span>{SYMBOL_KIND_LABELS[kind]}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Results */}
        <div ref={resultsRef} id="search-results" role="listbox" className="max-h-80 overflow-y-auto py-1">
          {activeTab === 'files' && (
            <FileResultsList
              query={query}
              results={fileResults}
              totalFileCount={allFiles.length}
              selectedIndex={selectedIndex}
              onSelect={onSelect}
            />
          )}
          {activeTab === 'code' && (
            <CodeResultsList
              query={debouncedQuery}
              results={codeResults}
              codeVisibleCount={visibleCodeItems.length}
              stats={codeResultStats}
              searchOptions={codeSearchOptions}
              selectedIndex={selectedIndex}
              onSelect={onSelect}
              collapsedFiles={collapsedFiles}
              onToggleFile={toggleFileCollapse}
              hasMore={hasMoreCodeResults}
              onLoadMore={loadMoreCodeResults}
              scrollContainerRef={resultsRef}
            />
          )}
          {activeTab === 'symbols' && (
            <SymbolResultsList
              query={debouncedQuery}
              results={symbolResults}
              totalSymbolCount={allSymbols.length}
              selectedIndex={selectedIndex}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Result List Components ────────────────────────────────────────── */

function FileResultsList({
  query,
  results,
  totalFileCount,
  selectedIndex,
  onSelect,
}: {
  query: string
  results: FileResult[]
  totalFileCount: number
  selectedIndex: number
  onSelect: (path: string, line?: number) => void
}) {
  if (!query.trim()) {
    return (
      <div className="px-3 py-4 text-center text-xs text-text-muted">
        Type to search across {totalFileCount} files
      </div>
    )
  }
  if (results.length === 0) {
    return <div className="px-3 py-4 text-center text-xs text-text-muted">No files found</div>
  }
  return (
    <>
      {results.map((f, i) => (
        <button
          key={f.path}
          id={`search-result-${i}`}
          data-index={i}
          role="option"
          aria-selected={i === selectedIndex}
          onClick={() => onSelect(f.path)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-150",
            "focus-visible:outline-none group",
            i === selectedIndex ? "bg-foreground/10" : "hover:bg-foreground/5",
          )}
        >
          <Code2 className="h-3.5 w-3.5 text-text-muted shrink-0" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs text-text-primary truncate group-hover:text-white">{f.name}</span>
            <span className="text-[10px] text-text-muted truncate">{f.path}</span>
          </div>
          <span className="text-[10px] text-text-muted tabular-nums shrink-0">
            L{f.lineCount}
          </span>
        </button>
      ))}
      <div className="px-3 py-1.5 text-[10px] text-text-muted text-center border-t border-foreground/[0.04]">
        {results.length} file{results.length !== 1 ? 's' : ''} found
      </div>
    </>
  )
}

type CodeResultItem = { file: string; match: SearchMatch; language?: string }

function CodeResultsList({
  query,
  results,
  codeVisibleCount,
  stats,
  searchOptions,
  selectedIndex,
  onSelect,
  collapsedFiles,
  onToggleFile,
  hasMore,
  onLoadMore,
  scrollContainerRef,
}: {
  query: string
  results: CodeResultItem[]
  codeVisibleCount: number
  stats: { totalMatches: number; fileCount: number; visibleCount: number } | null
  searchOptions: { caseSensitive: boolean; regex: boolean; wholeWord: boolean }
  selectedIndex: number
  onSelect: (path: string, line?: number) => void
  collapsedFiles: Set<string>
  onToggleFile: (file: string) => void
  hasMore: boolean
  onLoadMore: () => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!hasMore) return
    const sentinel = sentinelRef.current
    const container = scrollContainerRef.current
    if (!sentinel || !container) return

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onLoadMore() },
      { root: container, threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore, scrollContainerRef])

  if (!query.trim()) {
    return (
      <div className="px-3 py-4 text-center text-xs text-text-muted">
        Search across all file contents
      </div>
    )
  }
  if (results.length === 0) {
    return <div className="px-3 py-4 text-center text-xs text-text-muted">No matches found</div>
  }

  // Group all results by file (preserving order)
  const fileOrder: string[] = []
  const fileMatches = new Map<string, CodeResultItem[]>()
  for (const r of results) {
    if (!fileMatches.has(r.file)) {
      fileOrder.push(r.file)
      fileMatches.set(r.file, [])
    }
    fileMatches.get(r.file)!.push(r)
  }

  let visibleIdx = 0
  let visibleCount = 0

  return (
    <>
      {/* Stats header */}
      {stats && (
        <div className="px-3 py-1.5 text-[10px] text-text-muted text-center border-b border-foreground/[0.04]">
          {stats.visibleCount < stats.totalMatches
            ? `Showing ${stats.visibleCount} of ${stats.totalMatches} matches in ${stats.fileCount} file${stats.fileCount !== 1 ? 's' : ''}`
            : `${stats.totalMatches} match${stats.totalMatches !== 1 ? 'es' : ''} in ${stats.fileCount} file${stats.fileCount !== 1 ? 's' : ''}`
          }
        </div>
      )}
      {fileOrder.map(file => {
        const matches = fileMatches.get(file)!
        const isCollapsed = collapsedFiles.has(file)

        const matchElements: React.JSX.Element[] = []
        if (!isCollapsed) {
          for (const r of matches) {
            if (visibleCount >= codeVisibleCount) break
            visibleCount++
            const idx = visibleIdx++
            matchElements.push(
              <button
                key={`${r.file}-${r.match.line}-${r.match.column}`}
                id={`search-result-${idx}`}
                data-index={idx}
                role="option"
                aria-selected={idx === selectedIndex}
                onClick={() => onSelect(r.file, r.match.line)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1 text-left transition-colors duration-150",
                  "focus-visible:outline-none",
                  idx === selectedIndex ? "bg-foreground/10" : "hover:bg-foreground/5",
                )}
              >
                <span className="text-[10px] text-text-muted tabular-nums w-8 text-right shrink-0">
                  {r.match.line}
                </span>
                <span className="text-xs text-text-secondary truncate font-mono">
                  <HighlightedText
                    text={r.match.content.trim()}
                    query={query}
                    options={searchOptions}
                  />
                </span>
              </button>,
            )
          }
        }

        // Skip file groups with no visible matches (beyond visible limit)
        if (matchElements.length === 0 && !isCollapsed) return null

        return (
          <div key={file}>
            <button
              type="button"
              onClick={() => onToggleFile(file)}
              aria-expanded={!isCollapsed}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 border-b border-border/30 sticky top-0 z-10 hover:bg-muted/60 transition-colors"
            >
              {isCollapsed
                ? <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
                : <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
              }
              <Code2 className="h-3 w-3 text-blue-400 shrink-0" />
              <span className="text-[10px] font-semibold text-text-secondary truncate">{file}</span>
            </button>
            {matchElements}
          </div>
        )
      })}
      {hasMore && <div ref={sentinelRef} className="h-1" />}
    </>
  )
}

function SymbolResultsList({
  query,
  results,
  totalSymbolCount,
  selectedIndex,
  onSelect,
}: {
  query: string
  results: SymbolResult[]
  totalSymbolCount: number
  selectedIndex: number
  onSelect: (path: string, line?: number) => void
}) {
  if (!query.trim() && results.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-text-muted">
        {totalSymbolCount > 0
          ? `${totalSymbolCount} symbols indexed — type to search`
          : 'No symbols found in this repository'}
      </div>
    )
  }
  if (results.length === 0) {
    return <div className="px-3 py-4 text-center text-xs text-text-muted">No matching symbols</div>
  }
  return (
    <>
      {results.map((r, i) => {
        const Icon = SYMBOL_ICON_MAP[r.symbol.kind]
        const color = SYMBOL_KIND_COLORS[r.symbol.kind]
        return (
          <button
            key={`${r.filePath}-${r.symbol.name}-${r.symbol.line}-${i}`}
            id={`search-result-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === selectedIndex}
            onClick={() => onSelect(r.filePath, r.symbol.line)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150",
              "focus-visible:outline-none group",
              i === selectedIndex ? "bg-foreground/10" : "hover:bg-foreground/5",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", color)} />
            <span className={cn("text-xs truncate", r.symbol.isExported ? "text-text-primary font-medium" : "text-text-secondary")}>
              {r.symbol.name}
            </span>
            <span className={cn(
              "text-[10px] px-1 py-0.5 rounded border shrink-0",
              "border-foreground/10 text-text-muted"
            )}>
              {SYMBOL_KIND_LABELS[r.symbol.kind]}
            </span>
            <span className="text-[10px] text-text-muted truncate ml-auto">{r.fileName}</span>
            <span className="text-[10px] text-text-muted tabular-nums shrink-0">:{r.symbol.line}</span>
          </button>
        )
      })}
      <div className="px-3 py-1.5 text-[10px] text-text-muted text-center border-t border-foreground/[0.04]">
        {results.length} symbol{results.length !== 1 ? 's' : ''} found
      </div>
    </>
  )
}
