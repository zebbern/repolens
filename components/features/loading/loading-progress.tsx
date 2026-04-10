"use client"

import { useEffect, useState, useRef } from "react"
import { Check, Zap } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import type { LoadingStage } from "@/providers/repository-provider"

interface LoadingProgressProps {
  stage: LoadingStage
  progress?: { current: number; total: number }
  isCacheHit?: boolean
  error?: string | null
  repoName?: string
}

const STEPS = [
  { key: "metadata", label: "Metadata" },
  { key: "download", label: "Download" },
  { key: "extract", label: "Extract" },
  { key: "index", label: "Index" },
  { key: "ready", label: "Ready" },
] as const

type StepKey = (typeof STEPS)[number]["key"]

/** Map a LoadingStage to which step index is active (0-based). */
function stageToStepIndex(stage: LoadingStage): number {
  switch (stage) {
    case "idle":
      return -1
    case "metadata":
    case "tree":
    case "tree-ready":
      return 0
    case "downloading":
      return 1
    case "extracting":
      return 2
    case "indexing":
      return 3
    case "ready":
    case "cached":
      return 4
    default:
      return -1
  }
}

/** Sublabel shown below the progress bar. */
function getSublabel(
  stage: LoadingStage,
  progress?: { current: number; total: number },
  cacheHit?: boolean,
): string {
  if (cacheHit && stage === "cached") return "Loading from cache..."

  switch (stage) {
    case "metadata":
      return "Fetching repository metadata..."
    case "tree":
      return "Building file tree..."
    case "tree-ready":
      return "Fetching file contents..."
    case "downloading":
      return "Downloading source code..."
    case "extracting":
      return "Extracting files from archive..."
    case "indexing": {
      if (progress && progress.total > 0) {
        return `Indexing ${progress.current.toLocaleString()} of ${progress.total.toLocaleString()} files`
      }
      return "Indexing files..."
    }
    case "ready":
      return "Repository ready!"
    case "cached":
      return "Loaded from cache"
    default:
      return ""
  }
}

/** Current stage label shown large above the progress bar. */
function getStageLabel(stage: LoadingStage): string {
  switch (stage) {
    case "metadata":
    case "tree":
    case "tree-ready":
      return "Fetching repository..."
    case "downloading":
      return "Downloading source..."
    case "extracting":
      return "Extracting files..."
    case "indexing":
      return "Indexing codebase..."
    case "ready":
      return "Ready!"
    case "cached":
      return "Loaded from cache"
    default:
      return "Connecting..."
  }
}

function StepDot({
  state,
  isCacheHit,
}: {
  state: "pending" | "active" | "complete"
  isCacheHit: boolean
}) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Pulse ring behind active dot */}
      {state === "active" && !isCacheHit && (
        <span className="absolute h-5 w-5 rounded-full bg-status-info/30 animate-[pulse-ring_1.6s_ease-in-out_infinite]" />
      )}
      <span
        className={cn(
          "relative z-10 flex h-3 w-3 items-center justify-center rounded-full transition-all duration-500",
          state === "complete" && "bg-status-success scale-110",
          state === "active" && "bg-status-info",
          state === "pending" && "bg-foreground/15",
        )}
      >
        {state === "complete" && (
          <Check className="h-2 w-2 text-white" strokeWidth={3} />
        )}
      </span>
    </div>
  )
}

function StepConnector({ filled }: { filled: boolean }) {
  return (
    <div className="relative mx-0.5 h-px flex-1">
      <div className="absolute inset-0 bg-foreground/10 rounded-full" />
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out",
          filled ? "w-full bg-status-success" : "w-0 bg-status-info",
        )}
      />
    </div>
  )
}

export function LoadingProgress({
  stage,
  progress,
  isCacheHit = false,
  error,
  repoName,
}: LoadingProgressProps) {
  const activeIndex = stageToStepIndex(stage)
  const isComplete = stage === "ready" || stage === "cached"

  // Track elapsed time for cache hit display
  const startTimeRef = useRef(Date.now())
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    startTimeRef.current = Date.now()
  }, [])

  useEffect(() => {
    if (isComplete) {
      setElapsedMs(Date.now() - startTimeRef.current)
    }
  }, [isComplete])

  // Progress bar percentage
  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0

  // Show progress bar for stages that have measurable progress
  const hasProgressBar = stage === "indexing" && progress && progress.total > 0

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto p-6">
        {/* Steps showing error */}
        <div className="flex w-full items-center">
          {STEPS.map((step, i) => {
            const isErrorStep = i === activeIndex
            const stepState =
              i < activeIndex
                ? "complete"
                : isErrorStep
                  ? "active"
                  : "pending"
            return (
              <div key={step.key} className="contents">
                {i > 0 && <StepConnector filled={i <= activeIndex} />}
                <div className="relative flex items-center justify-center">
                  <span
                    className={cn(
                      "relative z-10 flex h-3 w-3 items-center justify-center rounded-full transition-all duration-500",
                      stepState === "complete" && "bg-status-success",
                      stepState === "active" && "bg-status-error",
                      stepState === "pending" && "bg-foreground/15",
                    )}
                  >
                    {stepState === "complete" && (
                      <Check className="h-2 w-2 text-white" strokeWidth={3} />
                    )}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Step labels */}
        <div className="flex w-full justify-between">
          {STEPS.map((step, i) => (
            <span
              key={step.key}
              className={cn(
                "text-[10px] transition-colors duration-300",
                i === activeIndex
                  ? "text-status-error font-medium"
                  : i < activeIndex
                    ? "text-status-success"
                    : "text-text-muted",
              )}
            >
              {step.label}
            </span>
          ))}
        </div>

        {/* Error message */}
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium text-status-error">
            Connection failed
          </p>
          <p className="text-xs text-text-muted max-w-xs">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto p-6 animate-in fade-in duration-300">
      {/* Step dots with connectors */}
      <div className="flex w-full items-center">
        {STEPS.map((step, i) => {
          let stepState: "pending" | "active" | "complete"
          if (isCacheHit && isComplete) {
            stepState = "complete"
          } else if (i < activeIndex) {
            stepState = "complete"
          } else if (i === activeIndex) {
            stepState = isComplete ? "complete" : "active"
          } else {
            stepState = "pending"
          }

          return (
            <div key={step.key} className="contents">
              {i > 0 && (
                <StepConnector
                  filled={
                    isCacheHit && isComplete
                      ? true
                      : i <= activeIndex
                  }
                />
              )}
              <StepDot state={stepState} isCacheHit={isCacheHit} />
            </div>
          )
        })}
      </div>

      {/* Step labels */}
      <div className="flex w-full justify-between">
        {STEPS.map((step, i) => {
          let color: string
          if (isCacheHit && isComplete) {
            color = "text-status-success"
          } else if (i < activeIndex) {
            color = "text-status-success"
          } else if (i === activeIndex) {
            color = isComplete
              ? "text-status-success font-medium"
              : "text-status-info font-medium"
          } else {
            color = "text-text-muted"
          }

          return (
            <span
              key={step.key}
              className={cn("text-[10px] transition-colors duration-300", color)}
            >
              {step.label}
            </span>
          )
        })}
      </div>

      {/* Stage label */}
      <div className="flex flex-col items-center gap-1.5 w-full">
        <p className="text-sm font-medium text-text-primary">
          {getStageLabel(stage)}
        </p>

        {/* Progress bar */}
        {hasProgressBar && (
          <Progress
            value={progressPercent}
            className="h-1.5 w-full bg-foreground/5"
          />
        )}

        {/* Sublabel */}
        <p className="text-xs text-text-muted">
          {getSublabel(stage, progress, isCacheHit)}
        </p>

        {/* Cache hit timing */}
        {isCacheHit && isComplete && elapsedMs > 0 && (
          <p className="flex items-center gap-1 text-xs text-status-success">
            <Zap className="h-3 w-3" />
            Loaded in {(elapsedMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      {/* Repo context */}
      {repoName && (
        <p className="text-[10px] text-text-muted">
          Repository: {repoName}
        </p>
      )}

      {/* Pulse animation keyframes (scoped via Tailwind arbitrary) */}
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0; transform: scale(1.8); }
        }
      `}</style>
    </div>
  )
}
