"use client"

import { useState, useCallback, type ReactNode } from 'react'
import { Maximize2, Sun, Moon, ImageDown, Code, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolbarAction {
  icon: ReactNode
  label: string
  onClick: () => void
  /** When true, show a check icon briefly after click */
  showCopiedFeedback?: boolean
}

interface MermaidToolbarProps {
  onFullscreen: () => void
  onToggleTheme: () => void
  onCopyImage: () => Promise<void>
  onCopySource: () => Promise<void>
  isDarkPreview: boolean
}

// ---------------------------------------------------------------------------
// ActionButton — a single icon button with tooltip & copy-success feedback
// ---------------------------------------------------------------------------

function ActionButton({ icon, label, onClick, showCopiedFeedback }: ToolbarAction) {
  const [isCopied, setIsCopied] = useState(false)

  const handleClick = useCallback(() => {
    onClick()
    if (showCopiedFeedback) {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    }
  }, [onClick, showCopiedFeedback])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={handleClick}
          aria-label={label}
        >
          {isCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isCopied ? 'Copied!' : label}
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// MermaidToolbar — floating toolbar for diagram interactions
// ---------------------------------------------------------------------------

export function MermaidToolbar({
  onFullscreen,
  onToggleTheme,
  onCopyImage,
  onCopySource,
  isDarkPreview,
}: MermaidToolbarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="absolute top-2 right-2 z-10 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 backdrop-blur-xs rounded-md p-0.5 border border-border shadow-xs">
        <ActionButton
          icon={<Maximize2 className="h-3.5 w-3.5" />}
          label="Fullscreen"
          onClick={onFullscreen}
        />
        <ActionButton
          icon={isDarkPreview
            ? <Sun className="h-3.5 w-3.5" />
            : <Moon className="h-3.5 w-3.5" />}
          label={isDarkPreview ? 'Light preview' : 'Dark preview'}
          onClick={onToggleTheme}
        />
        <ActionButton
          icon={<ImageDown className="h-3.5 w-3.5" />}
          label="Copy as PNG"
          onClick={onCopyImage}
          showCopiedFeedback
        />
        <ActionButton
          icon={<Code className="h-3.5 w-3.5" />}
          label="Copy source"
          onClick={onCopySource}
          showCopiedFeedback
        />
      </div>
    </TooltipProvider>
  )
}
