"use client"

import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react'

/** localStorage key for persisting the chat-collapsed preference across reloads. */
const CHAT_COLLAPSED_KEY = 'repolens:chat-collapsed'

// App Context Types
interface AppState {
  previewUrl: string | null
  isGenerating: boolean
  sidebarWidth: number
  selectedFilePath: string | null
  /** When true, the desktop chat sidebar is fully hidden. */
  isChatCollapsed: boolean
}

interface AppContextType extends AppState {
  setPreviewUrl: (url: string | null) => void
  setIsGenerating: (generating: boolean) => void
  setSidebarWidth: (width: number) => void
  setSelectedFilePath: (path: string | null) => void
  setChatCollapsed: (collapsed: boolean) => void
}

// Initial state
const initialState: AppState = {
  previewUrl: null,
  isGenerating: false,
  sidebarWidth: 320,
  selectedFilePath: null,
  isChatCollapsed: false,
}

// Context
const AppContext = createContext<AppContextType | null>(null)

// Provider
interface AppProviderProps {
  children: ReactNode
}

export function AppProvider({ children }: AppProviderProps) {
  const [previewUrl, setPreviewUrlState] = useState<string | null>(initialState.previewUrl)
  const [isGenerating, setIsGenerating] = useState(initialState.isGenerating)
  const [sidebarWidth, setSidebarWidth] = useState(initialState.sidebarWidth)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(initialState.selectedFilePath)
  const [isChatCollapsed, setIsChatCollapsed] = useState(initialState.isChatCollapsed)

  const setPreviewUrl = useCallback((url: string | null) => {
    setPreviewUrlState(prev => prev === url ? prev : url)
  }, [])

  // Restore the persisted chat-collapsed preference after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAT_COLLAPSED_KEY) === '1') setIsChatCollapsed(true)
    } catch {
      // localStorage unavailable (private mode / SSR) — ignore.
    }
  }, [])

  const setChatCollapsed = useCallback((collapsed: boolean) => {
    setIsChatCollapsed(collapsed)
    try {
      localStorage.setItem(CHAT_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // Persisting is best-effort — ignore failures.
    }
  }, [])

  const contextValue = useMemo<AppContextType>(() => ({
    previewUrl,
    isGenerating,
    sidebarWidth,
    selectedFilePath,
    isChatCollapsed,
    setPreviewUrl,
    setIsGenerating,
    setSidebarWidth,
    setSelectedFilePath,
    setChatCollapsed,
  }), [previewUrl, isGenerating, sidebarWidth, selectedFilePath, isChatCollapsed, setPreviewUrl, setChatCollapsed])

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
}

// Hook to use the app context
export function useApp() {
  const context = useContext(AppContext)
  if (context === null) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}
