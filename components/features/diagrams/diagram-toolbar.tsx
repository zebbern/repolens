"use client"

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Download, Network, X, Target, ChevronDown, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ICON_MAP } from './diagram-constants'
import type { DiagramType, DiagramViewMode, AvailableDiagram } from '@/lib/diagrams/diagram-data'

interface DiagramToolbarProps {
  availableDiagrams: AvailableDiagram[]
  viewMode: DiagramViewMode
  onSelectType: (type: DiagramType) => void
  onSelectOverview: () => void
  focusTarget: string | null
  onClearFocus: () => void
  canExport: boolean
  onExportSvg: () => void
  onExportPng: () => void
}

export function DiagramToolbar({
  availableDiagrams,
  viewMode,
  onSelectType,
  onSelectOverview,
  focusTarget,
  onClearFocus,
  canExport,
  onExportSvg,
  onExportPng,
}: DiagramToolbarProps) {
  const isOverview = viewMode === 'overview' && !focusTarget

  return (
    <div className="flex items-center justify-between border-b border-foreground/6 px-3 py-1.5 bg-card">
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {/* Overview tab */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectOverview}
          className={cn(
            'gap-1.5 h-7 text-xs shrink-0',
            isOverview ? 'bg-foreground/10 text-text-primary' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Overview
        </Button>

        {/* Separator */}
        <div className="w-px h-4 bg-foreground/10 mx-1 shrink-0" />

        {availableDiagrams.filter(d => d.available).map((d) => {
          const Icon = ICON_MAP[d.id] || Network
          const isActive = viewMode === d.id && !focusTarget
          return (
            <Button
              key={d.id}
              variant="ghost"
              size="sm"
              onClick={() => onSelectType(d.id)}
              className={cn(
                'gap-1.5 h-7 text-xs shrink-0',
                isActive ? 'bg-foreground/10 text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {d.label}
            </Button>
          )
        })}

        {/* Focus mode indicator */}
        {focusTarget && (
          <div className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
            <Target className="h-3 w-3 text-amber-400" />
            <span className="text-xs text-amber-400 font-medium">Focus: {focusTarget.split('/').pop()}</span>
            <button onClick={onClearFocus} className="ml-1 hover:text-amber-300">
              <X className="h-3 w-3 text-amber-500" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        {/* Export dropdown */}
        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs text-text-secondary hover:text-text-primary">
                <Download className="h-3.5 w-3.5" />
                Export
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuItem onClick={onExportSvg} className="text-xs gap-2">
                <Download className="h-3.5 w-3.5" />
                Export as SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportPng} className="text-xs gap-2">
                <Download className="h-3.5 w-3.5" />
                Export as PNG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
