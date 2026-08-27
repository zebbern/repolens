"use client"

import React, { useEffect, useRef } from 'react'
import { File, X, ChevronRight, Folder, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OpenTab } from './types'

interface CodeTabBarProps {
  openTabs: OpenTab[]
  activeTabPath: string | null
  onTabSelect: (path: string) => void
  onTabClose: (path: string, e?: React.MouseEvent) => void
  onRevertFile: (path: string) => void
  onEmptyFocus: () => void
}

export function CodeTabBar({
  openTabs,
  activeTabPath,
  onTabSelect,
  onTabClose,
  onRevertFile,
  onEmptyFocus,
}: CodeTabBarProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocusIndexRef = useRef<number | null>(null)

  useEffect(() => {
    const requestedIndex = pendingFocusIndexRef.current
    if (requestedIndex === null) return
    pendingFocusIndexRef.current = null
    if (openTabs.length === 0) {
      onEmptyFocus()
      return
    }
    tabRefs.current[Math.min(requestedIndex, openTabs.length - 1)]?.focus()
  }, [onEmptyFocus, openTabs])

  if (openTabs.length === 0) return null

  const focusTab = (index: number) => {
    const tab = openTabs[index]
    if (!tab) return
    onTabSelect(tab.path)
    tabRefs.current[index]?.focus()
  }

  const closeAndRestoreFocus = (path: string, index: number, event?: React.MouseEvent) => {
    pendingFocusIndexRef.current = index
    onTabClose(path, event)
  }

  const activeTabIndex = openTabs.findIndex(tab => tab.path === activeTabPath)
  const activeTab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null

  return (
    <div className="h-9 flex items-end bg-muted border-b border-foreground/6">
      <div
        role="tablist"
        aria-label="Open files"
        className="flex h-full min-w-0 flex-1 items-end overflow-x-auto"
      >
        {openTabs.map((tab, index) => (
          <button
            key={tab.path}
            ref={(element) => { tabRefs.current[index] = element }}
            type="button"
            role="tab"
            aria-selected={tab.path === activeTabPath}
            aria-label={`${tab.name}${tab.isModified ? ', modified' : ''}. Press Delete to close${tab.isModified ? ' or Alt+R to revert' : ''}.`}
            aria-keyshortcuts={tab.isModified ? 'Delete Alt+R' : 'Delete'}
            tabIndex={tab.path === activeTabPath ? 0 : -1}
            className={cn(
              'flex h-full min-w-0 items-center gap-2 border-r border-foreground/6 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
              tab.path === activeTabPath
                ? 'bg-background text-text-primary'
                : 'bg-surface-secondary text-text-secondary hover:bg-surface',
            )}
            onClick={() => onTabSelect(tab.path)}
            onAuxClick={(event) => {
              if (event.button === 1) closeAndRestoreFocus(tab.path, index, event)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Delete') {
                event.preventDefault()
                closeAndRestoreFocus(tab.path, index)
                return
              }
              if (event.altKey && event.key.toLowerCase() === 'r' && tab.isModified) {
                event.preventDefault()
                onRevertFile(tab.path)
                return
              }
              let nextIndex: number | null = null
              if (event.key === 'ArrowRight') nextIndex = (index + 1) % openTabs.length
              if (event.key === 'ArrowLeft') nextIndex = (index - 1 + openTabs.length) % openTabs.length
              if (event.key === 'Home') nextIndex = 0
              if (event.key === 'End') nextIndex = openTabs.length - 1
              if (nextIndex === null) return
              event.preventDefault()
              focusTab(nextIndex)
            }}
          >
            <File className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="text-sm truncate max-w-[120px]">{tab.name}</span>
            {tab.isModified && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />}
          </button>
        ))}
      </div>
      {activeTab && (
        <div className="flex h-full shrink-0 items-center gap-1 border-l border-foreground/6 px-2" aria-label="Active tab actions">
          {activeTab.isModified && (
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              onClick={() => onRevertFile(activeTab.path)}
              aria-label={`Revert changes to ${activeTab.name}`}
              title={`Revert changes to ${activeTab.name}`}
            >
              <Undo2 className="h-3 w-3 text-amber-400" />
            </button>
          )}
          <button
            type="button"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={`Close ${activeTab.name}`}
            onClick={(event) => closeAndRestoreFocus(activeTab.path, activeTabIndex, event)}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
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
    <div className="h-6 flex items-center px-4 bg-background border-b border-foreground/6">
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
