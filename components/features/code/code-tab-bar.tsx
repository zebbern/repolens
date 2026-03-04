"use client"

import React from 'react'
import { File, X, ChevronRight, Folder, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OpenTab } from './types'

interface CodeTabBarProps {
  openTabs: OpenTab[]
  activeTabPath: string | null
  onTabSelect: (path: string) => void
  onTabClose: (path: string, e: React.MouseEvent) => void
  onRevertFile: (path: string) => void
}

export function CodeTabBar({
  openTabs,
  activeTabPath,
  onTabSelect,
  onTabClose,
  onRevertFile,
}: CodeTabBarProps) {
  if (openTabs.length === 0) return null
  return (
    <div className="h-9 flex items-end bg-muted border-b border-foreground/[0.06] overflow-x-auto">
      {openTabs.map((tab) => (
        <div
          key={tab.path}
          className={cn(
            'h-full flex items-center gap-2 px-3 border-r border-foreground/[0.06] cursor-pointer group',
            tab.path === activeTabPath
              ? 'bg-background text-text-primary'
              : 'bg-surface-secondary text-text-secondary hover:bg-surface'
          )}
          onClick={() => onTabSelect(tab.path)}
        >
          <File className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="text-sm truncate max-w-[120px]">{tab.name}</span>
          {tab.isModified && (
            <button
              className="h-4 w-4 flex items-center justify-center rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onRevertFile(tab.path) }}
              title="Revert changes"
            >
              <Undo2 className="h-3 w-3 text-amber-400" />
            </button>
          )}
          <button
            className="h-4 w-4 flex items-center justify-center rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-100"
            onClick={(e) => onTabClose(tab.path, e)}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

interface CodeBreadcrumbProps {
  path: string
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onSwitchToExplorer: () => void
}

export function CodeBreadcrumb({
  path,
  expandedFolders,
  onToggleFolder,
  onSwitchToExplorer,
}: CodeBreadcrumbProps) {
  const parts = path.split('/')
  return (
    <div className="h-6 flex items-center px-4 bg-background border-b border-foreground/[0.06]">
      <div className="flex items-center gap-1 text-xs text-text-muted">
        {parts.map((part, i) => {
          const isFile = i === parts.length - 1
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {isFile ? (
                <span className="text-text-primary">
                  <File className="h-3 w-3 inline mr-1" />
                  {part}
                </span>
              ) : (
                <button
                  className="hover:text-text-primary"
                  onClick={() => {
                    const segments = parts.slice(0, i + 1)
                    for (let s = 1; s <= segments.length; s++) {
                      const folderPath = segments.slice(0, s).join('/')
                      if (!expandedFolders.has(folderPath)) {
                        onToggleFolder(folderPath)
                      }
                    }
                    onSwitchToExplorer()
                  }}
                >
                  {i === 0 ? <Folder className="h-3 w-3 inline mr-1" /> : null}
                  {part}
                </button>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
