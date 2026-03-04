"use client"

import { cn } from '@/lib/utils'

interface TaintFlowData {
  source: string
  sink: string
  path: string[]
  startLine: number
  endLine: number
}

interface TaintFlowDiagramProps {
  flow: TaintFlowData
  className?: string
}

type StepKind = 'source' | 'intermediate' | 'sink'

interface FlowStep {
  label: string
  kind: StepKind
}

const STEP_STYLES: Record<StepKind, { node: string; connector: string }> = {
  source: {
    node: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    connector: 'bg-blue-500/30',
  },
  intermediate: {
    node: 'bg-foreground/5 border-foreground/10 text-text-secondary',
    connector: 'bg-muted-foreground/30',
  },
  sink: {
    node: 'bg-red-500/10 border-red-500/30 text-red-400',
    connector: 'bg-red-500/30',
  },
}

function buildSteps(flow: TaintFlowData): FlowStep[] {
  const { path } = flow
  if (path.length === 0) return []

  return path.map((label, i) => {
    let kind: StepKind = 'intermediate'
    if (i === 0) kind = 'source'
    else if (i === path.length - 1) kind = 'sink'
    return { label, kind }
  })
}

function getStepAriaLabel(step: FlowStep, index: number, total: number): string {
  const position = `Step ${index + 1} of ${total}`
  const role = step.kind === 'source'
    ? 'Source'
    : step.kind === 'sink'
      ? 'Sink'
      : 'Transform'
  return `${position}: ${role} — ${step.label}`
}

export function TaintFlowDiagram({ flow, className }: TaintFlowDiagramProps) {
  const steps = buildSteps(flow)
  if (steps.length < 2) return null

  return (
    <div
      className={cn('flex flex-col gap-0 rounded-md border border-foreground/[0.06] bg-foreground/[0.02] p-2.5', className)}
    >
      <p className="text-[10px] font-medium text-text-muted mb-1.5">
        Data Flow: Lines {flow.startLine}–{flow.endLine}
      </p>
      <ol
        role="list"
        aria-label="Taint data flow path from source to sink"
        className="flex flex-col"
      >
        {steps.map((step, i) => {
          const style = STEP_STYLES[step.kind]
          const isLast = i === steps.length - 1

          return (
            <li
              key={`${step.label}-${i}`}
              aria-label={getStepAriaLabel(step, i, steps.length)}
              className="flex flex-col items-start"
            >
              {/* Node */}
              <div className="flex items-center gap-2 w-full">
                <span
                  className={cn(
                    'flex-shrink-0 w-3 h-3 flex items-center justify-center text-[6px] rounded-full border',
                    step.kind === 'source' && 'border-blue-500/40 bg-blue-500/20',
                    step.kind === 'sink' && 'border-red-500/40 bg-red-500/20',
                    step.kind === 'intermediate' && 'border-foreground/15 bg-foreground/5',
                  )}
                  aria-hidden="true"
                >
                  {step.kind !== 'intermediate' && (
                    <span className={cn(
                      'block w-1.5 h-1.5 rounded-full',
                      step.kind === 'source' && 'bg-blue-400',
                      step.kind === 'sink' && 'bg-red-400',
                    )} />
                  )}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-mono px-2 py-0.5 rounded border flex-1 min-w-0 truncate',
                    style.node,
                  )}
                >
                  {step.label}
                </span>
                <span className="text-[9px] text-text-muted/60 flex-shrink-0">
                  {step.kind === 'source' ? 'source' : step.kind === 'sink' ? 'sink' : ''}
                </span>
              </div>

              {/* Connector arrow between steps */}
              {!isLast && (
                <div
                  className="flex items-center ml-[5px] h-3"
                  aria-hidden="true"
                >
                  <div className={cn(
                    'w-px h-full',
                    style.connector,
                  )} />
                  <span className="text-text-muted/40 text-[8px] ml-1.5">↓</span>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
