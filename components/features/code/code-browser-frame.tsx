"use client"

import { forwardRef, useRef, type KeyboardEvent, type MouseEventHandler, type ReactNode, type RefObject } from 'react'

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CodeActivityBar } from './code-activity-bar'
import type { SidebarMode } from './types'

const SIDEBAR_LABELS: Record<SidebarMode, string> = {
  explorer: 'Explorer',
  search: 'Search',
  outline: 'Outline',
  tours: 'Tours',
}

interface CodeBrowserFrameProps {
  isMobile: boolean
  sidebarMode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
  mobileSidebarOpen: boolean
  onMobileSidebarOpenChange: (open: boolean) => void
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
  sidebarRef: RefObject<HTMLDivElement | null>
  onSidebarMouseDown: MouseEventHandler<HTMLDivElement>
  sidebar: ReactNode
  children: ReactNode
}

export const CodeBrowserFrame = forwardRef<HTMLDivElement, CodeBrowserFrameProps>(function CodeBrowserFrame({
  isMobile,
  sidebarMode,
  onModeChange,
  mobileSidebarOpen,
  onMobileSidebarOpenChange,
  sidebarWidth,
  onSidebarWidthChange,
  sidebarRef,
  onSidebarMouseDown,
  sidebar,
  children,
}, ref) {
  const mobileTriggerRef = useRef<HTMLElement | null>(null)

  const selectSidebarMode = (mode: SidebarMode, trigger: HTMLButtonElement) => {
    onModeChange(mode)
    if (isMobile) {
      mobileTriggerRef.current = trigger
      onMobileSidebarOpenChange(true)
    }
  }

  const resizeSidebarWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | undefined
    if (event.key === 'ArrowLeft') nextWidth = sidebarWidth - 10
    if (event.key === 'ArrowRight') nextWidth = sidebarWidth + 10
    if (event.key === 'Home') nextWidth = 160
    if (event.key === 'End') nextWidth = 400
    if (nextWidth === undefined) return

    event.preventDefault()
    onSidebarWidthChange(Math.max(160, Math.min(400, nextWidth)))
  }

  return (
    <div ref={ref} className="flex h-full min-w-0 bg-background">
      <CodeActivityBar sidebarMode={sidebarMode} onModeChange={selectSidebarMode} />

      {isMobile ? (
        <Sheet open={mobileSidebarOpen} onOpenChange={onMobileSidebarOpenChange}>
          <SheetContent
            side="left"
            aria-describedby={undefined}
            className="w-[min(85vw,20rem)] max-w-none gap-0 overflow-hidden border-foreground/10 p-0 pt-10 sm:max-w-none"
            onOpenAutoFocus={() => {
              const activeElement = document.activeElement
              mobileTriggerRef.current = activeElement instanceof HTMLElement && activeElement !== document.body
                ? activeElement
                : null
            }}
            onCloseAutoFocus={event => {
              const returnTarget = mobileTriggerRef.current
              mobileTriggerRef.current = null
              if (returnTarget?.isConnected) {
                event.preventDefault()
                returnTarget.focus()
              }
            }}
          >
            <SheetTitle className="sr-only">{SIDEBAR_LABELS[sidebarMode]} sidebar</SheetTitle>
            <div className="flex h-full min-h-0 flex-col">{sidebar}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          ref={sidebarRef}
          aria-label="Code sidebar"
          className="relative flex shrink-0 flex-col border-r border-foreground/6 bg-background"
          style={{ width: sidebarWidth }}
        >
          <div
            role="separator"
            aria-label="Resize code sidebar"
            aria-orientation="vertical"
            aria-valuemin={160}
            aria-valuemax={400}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/20 focus-visible:bg-primary/30 focus-visible:outline-none active:bg-primary/30"
            onMouseDown={onSidebarMouseDown}
            onKeyDown={resizeSidebarWithKeyboard}
          />
          {sidebar}
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col bg-background">{children}</div>
    </div>
  )
})

CodeBrowserFrame.displayName = 'CodeBrowserFrame'
