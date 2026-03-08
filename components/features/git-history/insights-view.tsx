"use client"

import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { estimateHours } from '@/lib/git-history'
import type { GitHubCommit } from '@/types/repository'
import { InsightsPulseCards } from './insights-pulse-cards'
import { InsightsHoursChart } from './insights-hours-chart'
import { InsightsPunchcard } from './insights-punchcard'
import { InsightsAuthorChart } from './insights-author-chart'

interface InsightsViewProps {
  commits: GitHubCommit[]
}

export function InsightsView({ commits }: InsightsViewProps) {
  const estimates = useMemo(() => estimateHours(commits), [commits])

  if (estimates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <BarChart3 className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Not enough commit data to generate insights
        </p>
      </div>
    )
  }

  return (
    <div className="h-full space-y-6 overflow-y-auto p-4">
      <InsightsPulseCards estimates={estimates} />
      <InsightsHoursChart estimates={estimates} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <InsightsPunchcard estimates={estimates} />
        <InsightsAuthorChart estimates={estimates} />
      </div>
    </div>
  )
}
