"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Lock, Maximize2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PreviewTab } from "./tab-config"

interface PreviewTabBarProps {
  tabs: PreviewTab[]
  activeTab: string
  onTabChange: (tab: string) => void
  hasRepo: boolean
  fileCount: number
  onOpenSearch: () => void
  localPreviewUrl: string | null
  hasApiKey: boolean
}

export function PreviewTabBar({
  tabs,
  activeTab,
  onTabChange,
  hasRepo,
  fileCount,
  onOpenSearch,
  localPreviewUrl,
  hasApiKey,
}: PreviewTabBarProps) {
  const [isMac, setIsMac] = useState(false)
  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().includes('MAC'))
  }, [])

  return (
    <div className="flex h-11 items-center justify-between border-b border-foreground/6 px-4 bg-card">
      <div className="flex items-center h-full gap-0.5 overflow-x-auto scrollbar-hide min-w-0" role="tablist" aria-label="Preview tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          const isLocked = tab.requiresAI && !hasApiKey
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={tab.label}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative flex items-center gap-1.5 h-full px-3 text-xs font-medium shrink-0 whitespace-nowrap",
                "transition-colors duration-150",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                isActive
                  ? "text-text-primary after:absolute after:bottom-0 after:inset-x-3 after:h-px after:bg-foreground"
                  : "text-text-secondary hover:text-text-primary",
                isLocked && "opacity-50"
              )}
              title={isLocked ? "Requires API key — set up in Settings" : tab.label}
            >
              <div className="relative">
                <Icon className="h-3.5 w-3.5" />
                {isLocked && (
                  <Lock className="absolute -bottom-0.5 -right-1 h-2 w-2 text-destructive" aria-hidden="true" />
                )}
              </div>
              <span className="hidden xl:inline">{tab.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1">
        {/* Global file search trigger */}
        {hasRepo && fileCount > 0 && (
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 h-7 px-2.5 rounded-md text-xs text-text-muted hover:text-text-secondary bg-foreground/3 border border-foreground/6 hover:border-foreground/10 transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            title={`Search (${isMac ? '⌘' : 'Ctrl+'}K)`}
          >
            <Search className="h-3 w-3" />
            <span className="hidden xl:inline">Search</span>
            <kbd className="hidden xl:inline text-[10px] text-text-muted/60 bg-foreground/4 px-1 py-0.5 rounded font-mono leading-none">{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
          </button>
        )}
        {localPreviewUrl && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => window.open(localPreviewUrl, "_blank")}
              title="Open in new tab"
              aria-label="Open in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring"
              title="Fullscreen"
              aria-label="Fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
