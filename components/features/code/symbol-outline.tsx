"use client"

import React, { useState } from "react"
import {
  Braces, Box, Shapes, Type, List, Code, ChevronRight,
  FileCode2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ExtractedSymbol } from "./hooks/use-symbol-extraction"

interface SymbolOutlineProps {
  symbols: ExtractedSymbol[]
  onSymbolClick: (line: number) => void
  activeSymbol?: number
}

const ICON_MAP: Record<ExtractedSymbol['kind'], React.ElementType> = {
  function: Braces,
  class: Box,
  interface: Shapes,
  type: Type,
  enum: List,
  variable: Code,
  method: Braces,
  property: Code,
}

const KIND_COLORS: Record<ExtractedSymbol['kind'], string> = {
  function: 'text-blue-400',
  class: 'text-amber-400',
  interface: 'text-green-400',
  type: 'text-purple-400',
  enum: 'text-orange-400',
  variable: 'text-cyan-400',
  method: 'text-blue-300',
  property: 'text-cyan-300',
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
          {symbols.length} symbol{symbols.length !== 1 ? 's' : ''}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="px-1 py-1">
          {symbols.map((symbol, i) => (
            <SymbolItem
              key={`${symbol.name}-${symbol.line}-${i}`}
              symbol={symbol}
              onSymbolClick={onSymbolClick}
              activeSymbol={activeSymbol}
              depth={0}
            />
          ))}
        </div>
      </ScrollArea>
    </>
  )
}
