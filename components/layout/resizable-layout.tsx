"use client"

import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useApp } from '@/providers'
import { SIDEBAR_CONFIG } from '@/config/constants'
import type { ResizableLayoutProps } from '@/types/types'

interface ResizableLayoutComponentProps extends ResizableLayoutProps {
  sidebarContent: React.ReactNode
  mainContent: React.ReactNode
  className?: string
}

export function ResizableLayout({
  sidebarContent,
  mainContent,
  defaultSidebarWidth = SIDEBAR_CONFIG.DEFAULT_WIDTH,
  minSidebarWidth = SIDEBAR_CONFIG.MIN_WIDTH,
  maxSidebarWidth = SIDEBAR_CONFIG.MAX_WIDTH,
  className
}: ResizableLayoutComponentProps) {
  const { sidebarWidth, setSidebarWidth } = useApp()
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Initialize sidebar width on mount
  useEffect(() => {
    if (sidebarWidth === 0) {
      setSidebarWidth(defaultSidebarWidth)
    }
  }, [sidebarWidth, setSidebarWidth, defaultSidebarWidth])

  // Debounced resize function to prevent excessive updates
  const debouncedSetSidebarWidth = useCallback((width: number) => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current)
    }
    
    resizeTimeoutRef.current = setTimeout(() => {
      setSidebarWidth(width)
    }, 0)
  }, [setSidebarWidth])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!sidebarRef.current || !isResizing) return

    const containerLeft = sidebarRef.current.parentElement!.getBoundingClientRect().left
    const newWidth = e.clientX - containerLeft
    const clampedWidth = Math.max(minSidebarWidth, Math.min(newWidth, maxSidebarWidth))
    
    // Update width immediately for smooth visual feedback
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${clampedWidth}px`
    }
    
    // Debounce the context update to prevent excessive re-renders
    debouncedSetSidebarWidth(clampedWidth)
  }, [isResizing, minSidebarWidth, maxSidebarWidth, debouncedSetSidebarWidth])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  // Event listeners for mouse events
  useEffect(() => {
    if (isResizing) {
      const handleMouseMoveGlobal = (e: MouseEvent) => handleMouseMove(e)
      const handleMouseUpGlobal = () => handleMouseUp()

      window.addEventListener('mousemove', handleMouseMoveGlobal)
      window.addEventListener('mouseup', handleMouseUpGlobal)

      return () => {
        window.removeEventListener('mousemove', handleMouseMoveGlobal)
        window.removeEventListener('mouseup', handleMouseUpGlobal)
      }
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
    }
  }, [])

  const currentWidth = sidebarWidth || defaultSidebarWidth

  return (
    <div className={cn('flex h-full flex-1 gap-2 overflow-hidden', className)}>
      <div 
        ref={sidebarRef} 
        style={{ 
          width: `${currentWidth}px`,
          transition: isResizing ? 'none' : 'width 0.2s ease'
        }} 
        className="relative shrink-0"
      >
        {sidebarContent}
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'absolute -right-1 top-0 h-full w-2 cursor-col-resize group z-10'
          )}
        >
          <div
            className={cn(
              'mx-auto h-full w-px transition-colors duration-200',
              'bg-interactive-border/0 group-hover:bg-status-info',
              isResizing && 'bg-status-info'
            )}
          />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {mainContent}
      </div>
    </div>
  )
}
