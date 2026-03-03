"use client"

import React, { useState, useMemo, useEffect, useCallback } from "react"
import {
  Braces, Box, Shapes, Type, List, Code, ChevronRight,
  FileCode2, Search, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ExtractedSymbol } from "./hooks/use-symbol-extraction"

interface SymbolOutlineProps {
  symbols: ExtractedSymbol[]
  onSymbolClick: (line: number) => void
  activeSymbol?: number
}

type SymbolKind = ExtractedSymbol['kind']

const ICON_MAP: Record<SymbolKind, React.ElementType> = {
  function: Braces,
  class: Box,
  interface: Shapes,
  type: Type,
  enum: List,
  variable: Code,
  method: Braces,
  property: Code,
}

const KIND_COLORS: Record<SymbolKind, string> = {
  function: 'text-blue-400',
  class: 'text-amber-400',
  interface: 'text-green-400',
  type: 'text-purple-400',
  enum: 'text-orange-400',
  variable: 'text-cyan-400',
  method: 'text-blue-300',
  property: 'text-cyan-300',
}

/** Top-level kinds shown as filter toggles (methods/properties are children, not top-level) */
const FILTERABLE_KINDS: SymbolKind[] = [
  'function', 'class', 'interface', 'type', 'enum', 'variable', 'method',
]

const KIND_LABELS: Record<SymbolKind, string> = {
  function: 'Fn',
  class: 'Cls',
  interface: 'Ifc',
  type: 'Typ',
  enum: 'Enm',
  variable: 'Var',
  method: 'Met',
  property: 'Prp',
}

/** Count all symbols recursively (including children) */
function countSymbols(symbols: ExtractedSymbol[]): number {
  let count = 0
  for (const s of symbols) {
    count += 1
    if (s.children) count += countSymbols(s.children)
  }
  return count
}

/** Count symbols by kind (including nested children) */
function countByKind(symbols: ExtractedSymbol[]): Record<SymbolKind, number> {
  const counts = {} as Record<SymbolKind, number>
  for (const kind of FILTERABLE_KINDS) counts[kind] = 0
  counts.property = 0

  function walk(list: ExtractedSymbol[]) {
    for (const s of list) {
      counts[s.kind] = (counts[s.kind] || 0) + 1
      if (s.children) walk(s.children)
    }
  }
  walk(symbols)
  return counts
}

/** Check if a symbol (or any of its children) matches the text query */
function symbolMatchesQuery(symbol: ExtractedSymbol, query: string): boolean {
  if (symbol.name.toLowerCase().includes(query)) return true
  if (symbol.children) {
    return symbol.children.some((child) => symbolMatchesQuery(child, query))
  }
  return false
}

/** Filter symbols by text query and active kinds, preserving hierarchy */
function filterSymbols(
  symbols: ExtractedSymbol[],
  query: string,
  activeKinds: Set<SymbolKind>,
): ExtractedSymbol[] {
  const result: ExtractedSymbol[] = []

  for (const symbol of symbols) {
    const kindActive = activeKinds.has(symbol.kind)
    const textMatch = !query || symbolMatchesQuery(symbol, query)

    if (symbol.children && symbol.children.length > 0) {
      // Filter children first
      const filteredChildren = filterSymbols(symbol.children, query, activeKinds)

      // Show parent if it directly matches, or if any child survived filtering
      if (kindActive && textMatch) {
        result.push({ ...symbol, children: filteredChildren.length > 0 ? filteredChildren : symbol.children })
      } else if (filteredChildren.length > 0 && kindActive) {
        result.push({ ...symbol, children: filteredChildren })
      }
    } else {
      if (kindActive && textMatch) {
        result.push(symbol)
      }
    }
  }

  return result
}

/** Debounced search hook */
function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

function SymbolItem({
  symbol,
  onSymbolClick,
  activeSymbol,
  depth = 0,
}: {
  symbol: ExtractedSymbol
  onSymbolClick: (line: number) => void
  activeSymbol?: number
  depth?: number
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const Icon = ICON_MAP[symbol.kind]
  const iconColor = KIND_COLORS[symbol.kind]
  const isActive = activeSymbol === symbol.line
  const hasChildren = symbol.children && symbol.children.length > 0

  return (
    <div>
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-sm rounded transition-colors text-left",
          "hover:bg-foreground/5",
          isActive && "bg-foreground/10 text-text-primary",
          !isActive && "text-text-secondary"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          onSymbolClick(symbol.line)
          if (hasChildren) setIsExpanded((prev) => !prev)
        }}
        title={`${symbol.kind}: ${symbol.name} (line ${symbol.line})`}
      >
        {hasChildren && (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-text-muted transition-transform",
              isExpanded && "rotate-90"
            )}
          />
        )}
        {!hasChildren && depth > 0 && <span className="w-3 shrink-0" />}
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
        <span className={cn("truncate flex-1", symbol.isExported && "font-medium")}>
          {symbol.name}
        </span>
        <span className="text-xs text-text-muted tabular-nums shrink-0">
          {symbol.line}
        </span>
      </button>

      {hasChildren && isExpanded && (
        <div>
          {symbol.children!.map((child, i) => (
            <SymbolItem
              key={`${child.name}-${child.line}-${i}`}
              symbol={child}
              onSymbolClick={onSymbolClick}
              activeSymbol={activeSymbol}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SymbolOutline({ symbols, onSymbolClick, activeSymbol }: SymbolOutlineProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedQuery = useDebouncedValue(searchQuery, 300)
  const [activeKinds, setActiveKinds] = useState<Set<SymbolKind>>(
    () => new Set(FILTERABLE_KINDS)
  )

  const kindCounts = useMemo(() => countByKind(symbols), [symbols])
  const totalCount = useMemo(() => countSymbols(symbols), [symbols])

  /** Kinds that actually exist in the current symbols */
  const presentKinds = useMemo(
    () => FILTERABLE_KINDS.filter((k) => kindCounts[k] > 0),
    [kindCounts],
  )

  const normalizedQuery = debouncedQuery.toLowerCase().trim()

  const filteredSymbols = useMemo(
    () => filterSymbols(symbols, normalizedQuery, activeKinds),
    [symbols, normalizedQuery, activeKinds],
  )

  const filteredCount = useMemo(() => countSymbols(filteredSymbols), [filteredSymbols])

  const isFiltering = normalizedQuery !== "" || activeKinds.size < FILTERABLE_KINDS.length

  const toggleKind = useCallback((kind: SymbolKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) {
        next.delete(kind)
      } else {
        next.add(kind)
      }
      return next
    })
  }, [])

  const clearFilters = useCallback(() => {
    setSearchQuery("")
    setActiveKinds(new Set(FILTERABLE_KINDS))
  }, [])

  if (symbols.length === 0) {
    return (
      <>
        <div className="h-9 flex items-center px-4 text-xs font-medium text-text-muted uppercase tracking-wide">
          Outline
        </div>
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <FileCode2 className="h-8 w-8 text-text-muted mb-3 opacity-50" />
          <p className="text-sm text-text-muted">No symbols found in this file</p>
          <p className="text-xs text-text-muted mt-1">
            Open a TypeScript, JavaScript, or Python file
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="h-9 flex items-center px-4 text-xs font-medium text-text-muted uppercase tracking-wide">
        Outline
        <span className="ml-auto text-[10px] text-text-muted tabular-nums">
          {isFiltering
            ? `${filteredCount} of ${totalCount} symbols`
            : `${totalCount} symbol${totalCount !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Filter controls */}
      <div className="px-2 pb-2 space-y-1.5">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter symbols..."
            className={cn(
              "w-full h-7 pl-7 pr-7 text-xs rounded-md bg-background border border-input",
              "placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-1 focus:ring-ring",
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center rounded-sm hover:bg-foreground/10 text-text-muted"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Kind toggle buttons */}
        {presentKinds.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {presentKinds.map((kind) => {
              const Icon = ICON_MAP[kind]
              const isActive = activeKinds.has(kind)
              const color = KIND_COLORS[kind]
              return (
                <button
                  key={kind}
                  onClick={() => toggleKind(kind)}
                  title={`${isActive ? 'Hide' : 'Show'} ${kind}s (${kindCounts[kind]})`}
                  className={cn(
                    "inline-flex items-center gap-0.5 h-5 px-1.5 rounded text-[10px] transition-colors border",
                    isActive
                      ? "border-foreground/15 bg-foreground/5 text-text-secondary"
                      : "border-transparent bg-transparent text-text-muted opacity-40 hover:opacity-70",
                  )}
                >
                  <Icon className={cn("h-3 w-3 shrink-0", isActive ? color : "text-text-muted")} />
                  <span className="tabular-nums">{kindCounts[kind]}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        {filteredSymbols.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <Search className="h-6 w-6 text-text-muted mb-2 opacity-50" />
            <p className="text-xs text-text-muted">No matching symbols</p>
            {isFiltering && (
              <button
                onClick={clearFilters}
                className="mt-2 text-xs text-blue-400 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="px-1 py-1">
            {filteredSymbols.map((symbol, i) => (
              <SymbolItem
                key={`${symbol.name}-${symbol.line}-${i}`}
                symbol={symbol}
                onSymbolClick={onSymbolClick}
                activeSymbol={activeSymbol}
                depth={0}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </>
  )
}
