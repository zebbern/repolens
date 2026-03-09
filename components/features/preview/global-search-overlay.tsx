"use client"

import { useRef, useEffect, useState, useMemo, useCallback } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Search, Code2, FileText, Braces, Box, Shapes, Type, List, Code,
  CaseSensitive, WholeWord, Regex, X, ChevronRight, ChevronDown,
  Filter, FilterX,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CodeIndex, SearchMatch } from "@/lib/code/code-index"
import { buildSearchRegex } from "@/lib/code/code-index"
import { searchInWorker, cancelPendingSearches } from "@/lib/code/search-worker-client"
import { fuzzyMatch } from "@/lib/code/fuzzy-match"
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

/* ── Fuzzy highlighting ────────────────────────────────────────────── */

function FuzzyHighlight({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>
  const indexSet = new Set(indices)
  const parts: React.ReactNode[] = []
  let i = 0
  while (i < text.length) {
    if (indexSet.has(i)) {
      let end = i
      while (end < text.length && indexSet.has(end)) end++
      parts.push(
        <mark key={i} className="bg-yellow-400/30 text-text-primary rounded-sm px-px">
          {text.slice(i, end)}
        </mark>,
      )
      i = end
    } else {
      let end = i
      while (end < text.length && !indexSet.has(end)) end++
      parts.push(<span key={i}>{text.slice(i, end)}</span>)
      i = end
    }
  }
  return <>{parts}</>
}

/* ── Virtualization types ──────────────────────────────────────────── */

type CodeFlatItem =
  | { type: 'header'; file: string; matchCount: number; isCollapsed: boolean }
  | { type: 'match'; item: CodeResultItem; selectableIndex: number }

type CodeResultItem = { file: string; match: SearchMatch; language?: string }

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

  const toggleFileCollapse = useCallback((file: string) => {
    setCollapsedFiles(prev => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }, [])

  // Reset selected index when query or tab changes
  useEffect(() => {
    setSelectedIndex(0)
    setCollapsedFiles(new Set())
  }, [debouncedQuery, activeTab])

  /* ── File search ──────────────────────────────────────────────── */

  const fileResults = useMemo(() => {
    if (activeTab !== 'files' || !query.trim()) return []
    const matches: Array<FileResult & { matchIndices: number[]; score: number }> = []
    for (const f of allFiles) {
      const result = fuzzyMatch(query, f.path)
      if (result) {
        matches.push({ ...f, matchIndices: result.indices, score: result.score })
      }
    }
    matches.sort((a, b) => b.score - a.score)
    return matches.slice(0, 200)
  }, [query, allFiles, activeTab])

  /* ── Code search (Web Worker) ──────────────────────────────────── */

  const [codeResults, setCodeResults] = useState<CodeResultItem[]>([])
  const [totalCodeMatches, setTotalCodeMatches] = useState(0)
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    if (activeTab !== 'code' || !debouncedQuery.trim()) {
      setCodeResults([])
      setTotalCodeMatches(0)
      setIsSearching(false)
      return
    }

    let stale = false
    setIsSearching(true)
    cancelPendingSearches()

    searchInWorker(codeIndex, debouncedQuery, codeSearchOptions)
      .then(results => {
        if (stale) return
        const filtered = excludeGenerated
          ? results.filter(r => !GENERATED_FILE_PATTERNS.some(p => p.test(r.file)))
          : results
        const items: CodeResultItem[] = []
        let total = 0
        for (const result of filtered) {
          total += result.matches.length
          for (const match of result.matches) {
            items.push({ file: result.file, match, language: result.language })
          }
        }
        setCodeResults(items)
        setTotalCodeMatches(total)
      })
      .catch(err => {
        if (!stale && err?.message !== 'Search cancelled') {
          console.warn('[search-worker] Search failed:', err)
        }
      })
      .finally(() => {
        if (!stale) setIsSearching(false)
      })

    return () => { stale = true }
  }, [debouncedQuery, codeIndex, codeSearchOptions, activeTab, excludeGenerated])

  // Cancel pending worker searches on unmount
  useEffect(() => {
    return () => cancelPendingSearches()
  }, [])

  // Selectable code items: matches excluding collapsed files (for keyboard nav)
  const codeSelectableItems = useMemo(() => {
    return codeResults.filter(r => !collapsedFiles.has(r.file))
  }, [codeResults, collapsedFiles])

  // Flat items list for virtualized rendering (headers + matches)
  const codeFlatItems = useMemo((): CodeFlatItem[] => {
    if (activeTab !== 'code' || codeResults.length === 0) return []
    const fileOrder: string[] = []
    const fileMatchMap = new Map<string, CodeResultItem[]>()
    for (const r of codeResults) {
      if (!fileMatchMap.has(r.file)) {
        fileOrder.push(r.file)
        fileMatchMap.set(r.file, [])
      }
      fileMatchMap.get(r.file)!.push(r)
    }
    const items: CodeFlatItem[] = []
    let selectableIndex = 0
    for (const file of fileOrder) {
      const matches = fileMatchMap.get(file)!
      const isCollapsed = collapsedFiles.has(file)
      items.push({ type: 'header', file, matchCount: matches.length, isCollapsed })
      if (!isCollapsed) {
        for (const m of matches) {
          items.push({ type: 'match', item: m, selectableIndex })
          selectableIndex++
        }
      }
    }
    return items
  }, [codeResults, collapsedFiles, activeTab])

  const codeResultStats = useMemo(() => {
    if (activeTab !== 'code' || !debouncedQuery.trim() || codeResults.length === 0) return null
    const fileCount = new Set(codeResults.map(r => r.file)).size
    return { totalMatches: totalCodeMatches, fileCount }
  }, [debouncedQuery, codeResults, activeTab, totalCodeMatches])

  /* ── Symbol search ────────────────────────────────────────────── */

  // Build cross-file symbol index asynchronously (content may be in IDB)
  const [allSymbols, setAllSymbols] = useState<SymbolResult[]>([])
  const [isExtractingSymbols, setIsExtractingSymbols] = useState(false)

  useEffect(() => {
    if (activeTab !== 'symbols') return

    let stale = false
    setIsExtractingSymbols(true)

    // Collect all file paths and fetch content in batch
    const paths = Array.from(codeIndex.files.keys())
    codeIndex.contentStore.getBatch(paths).then(contentMap => {
      if (stale) return
      const result: SymbolResult[] = []
      for (const [, file] of codeIndex.files) {
        const content = contentMap.get(file.path)
        if (!content) continue
        const symbols = extractSymbols(content, file.language)
        for (const symbol of symbols) {
          result.push({ symbol, filePath: file.path, fileName: file.name })
          if (symbol.children) {
            for (const child of symbol.children) {
              result.push({ symbol: child, filePath: file.path, fileName: file.name })
            }
          }
        }
      }
      setAllSymbols(result)
      setIsExtractingSymbols(false)
    })

    return () => { stale = true }
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
  }, [debouncedQuery, allSymbols, activeKinds, activeTab])

  /* ── Navigable items ──────────────────────────────────────────── */

  const itemCount = activeTab === 'files'
    ? fileResults.length
    : activeTab === 'code'
      ? codeSelectableItems.length
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
      const result = codeSelectableItems[index]
      if (result) onSelect(result.file, result.match.line)
    } else {
      const result = symbolResults[index]
      if (result) onSelect(result.filePath, result.symbol.line)
    }
  }, [activeTab, fileResults, codeSelectableItems, symbolResults, onSelect])

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
        <div ref={resultsRef} id="search-results" role="listbox" className="max-h-80 overflow-y-auto">
          {activeTab === 'files' && (
            <FileResultsList
              query={query}
              results={fileResults}
              totalFileCount={allFiles.length}
              selectedIndex={selectedIndex}
              onSelect={onSelect}
              scrollRef={resultsRef}
            />
          )}
          {activeTab === 'code' && (
            <CodeResultsList
              query={debouncedQuery}
              flatItems={codeFlatItems}
              stats={codeResultStats}
              searchOptions={codeSearchOptions}
              selectedIndex={selectedIndex}
              onSelect={onSelect}
              onToggleFile={toggleFileCollapse}
              scrollRef={resultsRef}
              isSearching={isSearching}
            />
          )}
          {activeTab === 'symbols' && (
            <SymbolResultsList
              query={debouncedQuery}
              results={symbolResults}
              totalSymbolCount={allSymbols.length}
              selectedIndex={selectedIndex}
              onSelect={onSelect}
              scrollRef={resultsRef}
              isLoading={isExtractingSymbols}
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
  scrollRef,
}: {
  query: string
  results: Array<FileResult & { matchIndices: number[]; score: number }>
  totalFileCount: number
  selectedIndex: number
  onSelect: (path: string, line?: number) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 20,
  })

  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < results.length) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
    }
  }, [selectedIndex, virtualizer, results.length])

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
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const f = results[virtualRow.index]
          const i = virtualRow.index
          return (
            <button
              key={f.path}
              id={`search-result-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === selectedIndex}
              onClick={() => onSelect(f.path)}
              style={{
                position: 'absolute',
                top: virtualRow.start,
                height: virtualRow.size,
                width: '100%',
              }}
              className={cn(
                "flex items-center gap-2 px-3 text-left transition-colors duration-150",
                "focus-visible:outline-none group",
                i === selectedIndex ? "bg-foreground/10" : "hover:bg-foreground/5",
              )}
            >
              <Code2 className="h-3.5 w-3.5 text-text-muted shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs text-text-primary truncate group-hover:text-white">{f.name}</span>
                <span className="text-[10px] text-text-muted truncate">
                  <FuzzyHighlight text={f.path} indices={f.matchIndices} />
                </span>
              </div>
              <span className="text-[10px] text-text-muted tabular-nums shrink-0">
                L{f.lineCount}
              </span>
            </button>
          )
        })}
      </div>
      <div className="px-3 py-1.5 text-[10px] text-text-muted text-center border-t border-foreground/[0.04]">
        {results.length} file{results.length !== 1 ? 's' : ''} found
      </div>
    </>
  )
}

function CodeResultsList({
  query,
  flatItems,
  stats,
  searchOptions,
  selectedIndex,
  onSelect,
  onToggleFile,
  scrollRef,
  isSearching,
}: {
  query: string
  flatItems: CodeFlatItem[]
  stats: { totalMatches: number; fileCount: number } | null
  searchOptions: { caseSensitive: boolean; regex: boolean; wholeWord: boolean }
  selectedIndex: number
  onSelect: (path: string, line?: number) => void
  onToggleFile: (file: string) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  isSearching: boolean
}) {
  const estimateSize = useCallback(
    (index: number) => flatItems[index]?.type === 'header' ? 40 : 28,
    [flatItems],
  )

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 20,
  })

  useEffect(() => {
    if (selectedIndex < 0) return
    const flatIdx = flatItems.findIndex(
      item => item.type === 'match' && item.selectableIndex === selectedIndex,
    )
    if (flatIdx >= 0) {
      virtualizer.scrollToIndex(flatIdx, { align: 'auto' })
    }
  }, [selectedIndex, flatItems, virtualizer])

  if (!query.trim()) {
    return (
      <div className="px-3 py-4 text-center text-xs text-text-muted">
        Search across all file contents
      </div>
    )
  }
  if (isSearching && flatItems.length === 0) {
    return <div className="px-3 py-4 text-center text-xs text-text-muted">Searching…</div>
  }
  if (flatItems.length === 0) {
    return <div className="px-3 py-4 text-center text-xs text-text-muted">No matches found</div>
  }

  return (
    <>
      {stats && (
        <div className="px-3 py-1.5 text-[10px] text-text-muted text-center border-b border-foreground/[0.04]">
          {stats.totalMatches} match{stats.totalMatches !== 1 ? 'es' : ''} in {stats.fileCount} file{stats.fileCount !== 1 ? 's' : ''}
        </div>
      )}
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const flatItem = flatItems[virtualRow.index]
          if (flatItem.type === 'header') {
            return (
              <button
                key={`header-${flatItem.file}`}
                type="button"
                onClick={() => onToggleFile(flatItem.file)}
                aria-expanded={!flatItem.isCollapsed}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  height: virtualRow.size,
                  width: '100%',
                }}
                className="flex items-center gap-1.5 px-3 bg-muted/40 border-b border-border/30 hover:bg-muted/60 transition-colors"
              >
                {flatItem.isCollapsed
                  ? <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
                  : <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
                }
                <Code2 className="h-3 w-3 text-blue-400 shrink-0" />
                <span className="text-[10px] font-semibold text-text-secondary truncate">{flatItem.file}</span>
              </button>
            )
          }
          const r = flatItem.item
          const idx = flatItem.selectableIndex
          return (
            <button
              key={`${r.file}-${r.match.line}-${r.match.column}`}
              id={`search-result-${idx}`}
              data-index={idx}
              role="option"
              aria-selected={idx === selectedIndex}
              onClick={() => onSelect(r.file, r.match.line)}
              style={{
                position: 'absolute',
                top: virtualRow.start,
                height: virtualRow.size,
                width: '100%',
              }}
              className={cn(
                "flex items-center gap-2 px-3 text-left transition-colors duration-150",
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
            </button>
          )
        })}
      </div>
    </>
  )
}

function SymbolResultsList({
  query,
  results,
  totalSymbolCount,
  selectedIndex,
  onSelect,
  scrollRef,
  isLoading,
}: {
  query: string
  results: SymbolResult[]
  totalSymbolCount: number
  selectedIndex: number
  onSelect: (path: string, line?: number) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  isLoading?: boolean
}) {
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 20,
  })

  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < results.length) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
    }
  }, [selectedIndex, virtualizer, results.length])

  if (isLoading) {
    return (
      <div className="px-3 py-4 text-center text-xs text-text-muted">
        Extracting symbols…
      </div>
    )
  }

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
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const r = results[virtualRow.index]
          const i = virtualRow.index
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
              style={{
                position: 'absolute',
                top: virtualRow.start,
                height: virtualRow.size,
                width: '100%',
              }}
              className={cn(
                "flex items-center gap-2 px-3 text-left transition-colors duration-150",
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
      </div>
      <div className="px-3 py-1.5 text-[10px] text-text-muted text-center border-t border-foreground/[0.04]">
        {results.length} symbol{results.length !== 1 ? 's' : ''} found
      </div>
    </>
  )
}
