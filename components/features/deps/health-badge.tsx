"use client"

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { HealthGrade } from '@/lib/deps/types'

const GRADE_STYLES: Record<HealthGrade, string> = {
  A: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400',
  B: 'bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400',
  C: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30 dark:text-yellow-400',
  D: 'bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400',
  F: 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400',
}

interface HealthBadgeProps {
  grade: HealthGrade | null
  score: number | null
  className?: string
}

export function HealthBadge({ grade, score, className }: HealthBadgeProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            aria-label={`Health grade: ${grade ?? 'unknown'}`}
            className={cn(
              'cursor-default font-bold text-xs tabular-nums',
              grade ? GRADE_STYLES[grade] : 'bg-muted text-muted-foreground',
              className,
            )}
          >
            {grade ?? '?'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Score: {score == null ? 'Unknown' : `${score}/100`}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
