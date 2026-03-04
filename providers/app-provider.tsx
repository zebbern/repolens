"use client"

import { createContext, useContext, useState, type ReactNode } from 'react'

// App Context Types
interface AppState {
  previewUrl: string | null
  isGenerating: boolean
  sidebarWidth: number
}

interface AppContextType extends AppState {
  setPreviewUrl: (url: string | null) => void
  setIsGenerating: (generating: boolean) => void
  setSidebarWidth: (width: number) => void
}

// Initial state
const initialState: AppState = {
  previewUrl: null,
  isGenerating: false,
  sidebarWidth: 320,
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

  const setPreviewUrl = (url: string | null) => {
    if (url === previewUrl) return
    setPreviewUrlState(url)
  }

  const contextValue: AppContextType = {
    previewUrl,
    isGenerating,
    sidebarWidth,
    setPreviewUrl,
    setIsGenerating,
    setSidebarWidth,
  }

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
