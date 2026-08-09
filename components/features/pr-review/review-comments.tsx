"use client"

import { AlertCircle, AlertTriangle, Lightbulb, ThumbsUp, Sparkles } from "lucide-react"
import type { ReviewFinding, ReviewSeverity } from "@/types/pr-review"

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  ReviewSeverity,
  { icon: typeof AlertCircle; color: string; bgColor: string; label: string }
> = {
  critical: {
    icon: AlertCircle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-500/10 border-red-500/20",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-yellow-600 dark:text-yellow-400",
    bgColor: "bg-yellow-500/10 border-yellow-500/20",
    label: "Warning",
  },
  suggestion: {
    icon: Lightbulb,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/20",
    label: "Suggestion",
  },
  praise: {
    icon: ThumbsUp,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-500/10 border-green-500/20",
    label: "Praise",
  },
}

// ---------------------------------------------------------------------------
// ReviewAnnotation — inline annotation shown below a diff line
// ---------------------------------------------------------------------------

interface ReviewAnnotationProps {
  finding: ReviewFinding
}

export function ReviewAnnotation({ finding }: ReviewAnnotationProps) {
  const config = SEVERITY_CONFIG[finding.severity]
  const Icon = config.icon

  return (
    <div className={`mx-4 my-1 rounded-md border p-3 ${config.bgColor}`}>
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${config.color}`}>{config.label}</span>
            <span className="text-xs text-muted-foreground">{finding.category}</span>
          </div>
          <p className="text-sm">{finding.message}</p>
          {finding.suggestion && (
            <pre className="mt-1.5 rounded bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap overflow-x-auto">
              {finding.suggestion}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReviewSummary — overview of all findings
// ---------------------------------------------------------------------------

interface ReviewSummaryProps {
  findings: ReviewFinding[]
}

export function ReviewSummary({ findings }: ReviewSummaryProps) {
  if (findings.length === 0) return null

  const counts = findings.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1
      return acc
    },
    {} as Partial<Record<ReviewSeverity, number>>,
  )

  return (
    <div className="flex items-center gap-3 text-xs">
      <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
      {(["critical", "warning", "suggestion", "praise"] as const).map((severity) => {
        const count = counts[severity]
        if (!count) return null
        const config = SEVERITY_CONFIG[severity]
        return (
          <span key={severity} className={`flex items-center gap-1 ${config.color}`}>
            {count} {config.label.toLowerCase()}
          </span>
        )
      })}
    </div>
  )
}
