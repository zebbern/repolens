// Shared types for the code browser components

import type { ExtractedSymbol } from './hooks/use-symbol-extraction'

export type InlineActionType = 'explain' | 'refactor' | 'find-usages' | 'complexity'

export interface SymbolRange {
  symbol: ExtractedSymbol
  startLine: number
  endLine: number
}

export interface InlineActionResult {
  type: InlineActionType
  symbolName: string
  content: string
  isStreaming: boolean
  error?: string
}

export interface OpenTab {
  path: string
  name: string
  language?: string
  content: string | null
  originalContent: string | null
  isLoading: boolean
  error: string | null
  isModified: boolean
}

export type SidebarMode = 'explorer' | 'search' | 'outline'

export interface CodeBrowserProps {
  navigateToFile?: string | null
  onNavigateComplete?: () => void
}

export interface SearchOptions {
  caseSensitive: boolean
  regex: boolean
  wholeWord: boolean
}
