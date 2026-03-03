// Shared types for the code browser components

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

export type SidebarMode = 'explorer' | 'search'

export interface CodeBrowserProps {
  navigateToFile?: string | null
  onNavigateComplete?: () => void
}

export interface SearchOptions {
  caseSensitive: boolean
  regex: boolean
  wholeWord: boolean
}
