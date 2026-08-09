"use client"

import { useMemo } from "react"
import { Progress } from "@/components/ui/progress"
import { getModelContextWindow } from "@/lib/ai/providers"
import { formatTokenCount, estimateCost } from "@/lib/ai/token-cost"

interface TokenUsageFooterProps {
  inputTokens: number
  outputTokens: number
  model: string
}

export function TokenUsageFooter({ inputTokens, outputTokens, model }: TokenUsageFooterProps) {
  const cost = useMemo(() => estimateCost(model, inputTokens, outputTokens), [model, inputTokens, outputTokens])

  const contextWindow = useMemo(() => getModelContextWindow(model), [model])
  const totalTokens = inputTokens + outputTokens
  const contextUtilization = useMemo(() => {
    return Math.min((totalTokens / contextWindow) * 100, 100)
  }, [totalTokens, contextWindow])

  if (inputTokens === 0 && outputTokens === 0) {
    return (
      <div className="px-3 pb-1 pt-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>No token usage yet</span>
        </div>
      </div>
    )
  }

  const progressColor = contextUtilization >= 85
    ? 'bg-red-500'
    : contextUtilization >= 60
      ? 'bg-amber-500'
      : undefined

  return (
    <div className="px-3 pb-1 pt-1.5 space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span title="Context window usage">
          {formatTokenCount(totalTokens)} / {formatTokenCount(contextWindow)} ({Math.round(contextUtilization)}%)
        </span>
        {cost !== null && (
          <span title="Estimated cost">~${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}</span>
        )}
      </div>
      <Progress
        value={contextUtilization}
        max={100}
        aria-label="AI context window usage"
        className="h-1 bg-foreground/6"
        indicatorClassName={progressColor}
      />
    </div>
  )
}
