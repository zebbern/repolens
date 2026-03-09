"use client"

import React, { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { CodeEditor } from './code-editor'
import type { CodeIssue } from '@/lib/code/issue-scanner'
import type { SearchOptions, SymbolRange, InlineActionType } from './types'
import type { ContentAvailability } from '@/lib/repository'

interface CodeEditorContentProps {
  /** Indexing progress state */
  isIndexingComplete: boolean
  indexingPercent: number
  indexingCurrent: number
  indexingTotal: number
  /** Active tab info */
  activeTab: {
    path: string
    content: string | null | undefined
    language: string | undefined
    isLoading: boolean
    error?: string | null
  } | null
  /** Search state for editor highlighting */
  highlightedLine: { path: string; line: number } | null
  onHighlightComplete: () => void
  searchQuery: string
  searchOptions: SearchOptions
  sidebarMode: string
  /** Issues for the active file */
  issues: CodeIssue[]
  /** Inline action props */
  symbolRanges?: SymbolRange[]
  onLineHover?: (lineNumber: number) => void
  onLineLeave?: () => void
  hoveredSymbolRange?: SymbolRange | null
  onAction?: (type: InlineActionType) => void
  hasApiKey?: boolean
  /** Multi-line range highlight for tour stops */
  highlightedRange?: { startLine: number; endLine: number } | null
  /** Whether content is fully loaded or lazy (metadata-only). */
  contentAvailability?: ContentAvailability
}

export function CodeEditorContent({
  isIndexingComplete,
  indexingPercent,
  indexingCurrent,
  indexingTotal,
  activeTab,
  highlightedLine,
  onHighlightComplete,
  searchQuery,
  searchOptions,
  sidebarMode,
  issues,
  symbolRanges,
  onLineHover,
  onLineLeave,
  hoveredSymbolRange,
  onAction,
  hasApiKey,
  highlightedRange,
  contentAvailability,
}: CodeEditorContentProps) {
  const editorRef = useRef<HTMLDivElement>(null)

  // Loading state while indexing
  if (!isIndexingComplete && indexingTotal > 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-6 w-full max-w-xs">
          <div className="relative">
            <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,0.1)" strokeWidth="6" fill="none" />
              <circle
                cx="50" cy="50" r="42"
                stroke="url(#progressGradient)"
                strokeWidth="6" fill="none" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 42}`}
                strokeDashoffset={`${2 * Math.PI * 42 * (1 - indexingPercent / 100)}`}
                className="transition-all duration-300 ease-out"
              />
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-semibold text-text-primary">{indexingPercent}%</span>
            </div>
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-text-primary">Indexing Repository</p>
            <p className="text-xs text-text-muted">{indexingCurrent} of {indexingTotal} files</p>
          </div>
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    )
  }

  if (activeTab) {
    if (activeTab.isLoading) {
      const isLazy = contentAvailability !== 'full'
      return (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
            {isLazy && (
              <p className="text-xs text-text-muted">Loading file content…</p>
            )}
          </div>
        </div>
      )
    }
    if (activeTab.error) {
      return (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-status-error">{activeTab.error}</p>
        </div>
      )
    }
    if (activeTab.content) {
      return (
        <CodeEditor
          ref={editorRef}
          content={activeTab.content}
          language={activeTab.language}
          highlightedLine={highlightedLine?.path === activeTab.path ? highlightedLine.line : undefined}
          searchQuery={sidebarMode === 'search' ? searchQuery : ''}
          searchOptions={searchOptions}
          onHighlightComplete={onHighlightComplete}
          issues={issues}
          onLineHover={onLineHover}
          onLineLeave={onLineLeave}
          hoveredSymbolRange={hoveredSymbolRange}
          onAction={onAction}
          hasApiKey={hasApiKey}
          highlightedRange={highlightedRange}
        />
      )
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-text-muted">Select a file to view</p>
    </div>
  )
}
