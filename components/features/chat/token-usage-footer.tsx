"use client"

import { useMemo } from "react"
import { Progress } from "@/components/ui/progress"
import { getModelContextWindow } from "@/lib/ai/providers"

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI (per 1M tokens)
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o3-mini': { input: 1.1, output: 4.4 },
  // Anthropic
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  // Google
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`
  }
  if (count >= 1_000) {
    const k = count / 1_000
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`
  }
  return String(count)
}

function getModelPricing(model: string) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]
  const sorted = Object.entries(MODEL_PRICING).sort((a, b) => b[0].length - a[0].length)
  for (const [key, pricing] of sorted) {
    if (model.includes(key)) return pricing
  }
  return null
}

interface TokenUsageFooterProps {
  inputTokens: number
  outputTokens: number
  model: string
}

export function TokenUsageFooter({ inputTokens, outputTokens, model }: TokenUsageFooterProps) {
  const pricing = useMemo(() => getModelPricing(model), [model])

  const cost = useMemo(() => {
    if (!pricing) return null
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
  }, [inputTokens, outputTokens, pricing])

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
        className="h-1 bg-foreground/6"
        indicatorClassName={progressColor}
      />
    </div>
  )
}
