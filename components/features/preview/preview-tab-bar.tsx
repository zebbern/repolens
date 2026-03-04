"use client"

import { ExternalLink, Maximize2, Search } from "lucide-react"
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
}

export function PreviewTabBar({
  tabs,
  activeTab,
  onTabChange,
  hasRepo,
  fileCount,
  onOpenSearch,
  localPreviewUrl,
}: PreviewTabBarProps) {
  return (
    <div className="flex h-11 items-center justify-between border-b border-foreground/[0.06] px-4 bg-card">
      <div className="flex items-center h-full gap-0.5">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative flex items-center gap-1.5 h-full px-3 text-xs font-medium transition-colors",
                isActive
                  ? "text-text-primary after:absolute after:bottom-0 after:inset-x-3 after:h-px after:bg-foreground"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1">
        {/* Global file search trigger */}
        {hasRepo && fileCount > 0 && (
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 h-7 px-2.5 rounded-md text-xs text-text-muted hover:text-text-secondary bg-foreground/[0.03] border border-foreground/[0.06] hover:border-foreground/10 transition-colors"
            title="Search files (Ctrl+K)"
          >
            <Search className="h-3 w-3" />
            <span className="hidden sm:inline">Search files</span>
            <kbd className="hidden sm:inline text-[10px] text-text-muted/60 bg-foreground/[0.04] px-1 py-0.5 rounded font-mono leading-none">{'⌘K'}</kbd>
          </button>
        )}
        {localPreviewUrl && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
              onClick={() => window.open(localPreviewUrl, "_blank")}
              title="Open in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
              title="Fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
