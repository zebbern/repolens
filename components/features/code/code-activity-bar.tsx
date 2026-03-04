"use client"

import { Button } from '@/components/ui/button'
import { FileText, Search, ListTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SidebarMode } from './types'

interface CodeActivityBarProps {
  sidebarMode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
}

export function CodeActivityBar({ sidebarMode, onModeChange }: CodeActivityBarProps) {
  const items: { mode: SidebarMode; icon: typeof FileText; label: string }[] = [
    { mode: 'explorer', icon: FileText, label: 'Explorer' },
    { mode: 'search', icon: Search, label: 'Search' },
    { mode: 'outline', icon: ListTree, label: 'Outline' },
  ]

  return (
    <div className="w-12 shrink-0 bg-background border-r border-foreground/[0.06] flex flex-col items-center py-2 gap-2">
      {items.map(({ mode, icon: Icon, label }) => (
        <Button
          key={mode}
          variant="ghost"
          size="icon"
          className={cn(
            'h-10 w-10',
            sidebarMode === mode
              ? 'text-text-primary bg-foreground/10'
              : 'text-text-muted hover:text-text-primary'
          )}
          onClick={() => onModeChange(mode)}
          title={label}
        >
          <Icon className="h-5 w-5" />
        </Button>
      ))}
    </div>
  )
}
