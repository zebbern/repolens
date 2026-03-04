"use client"

import type { ScanResults } from '@/lib/code/issue-scanner'
import type { BatchProgress } from '@/hooks/use-batch-operations'
import { GRADE_CONFIG, getRiskScoreColor } from './constants'
import { cn } from '@/lib/utils'
import { Bug, Shield, ShieldCheck, Wrench, Loader2, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface IssueSummaryProps {
  results: ScanResults
  hasValidApiKey: boolean
  filteredIssueCount: number
  criticalCount: number
  validationProgress: BatchProgress
  fixProgress: BatchProgress
  onBatchValidate: () => void
  onBatchGenerateFixes: () => void
  onCancelBatch: () => void
}

export function IssueSummary({
  results,
  hasValidApiKey,
  filteredIssueCount,
  criticalCount,
  validationProgress,
  fixProgress,
  onBatchValidate,
  onBatchGenerateFixes,
  onCancelBatch,
}: IssueSummaryProps) {
  const gradeCfg = GRADE_CONFIG[results.healthGrade]
  const projectRiskColor = results.projectRiskScore != null ? getRiskScoreColor(results.projectRiskScore) : null
  const riskDist = results.riskDistribution
  const riskDistTotal = riskDist ? riskDist.critical + riskDist.high + riskDist.medium + riskDist.low : 0

  return (
    <>
      {/* Top row: title + grade + project risk */}
      <div className="flex items-center gap-2 mb-3">
        <Bug className="h-4 w-4 text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary tracking-tight">Code Analysis</h2>
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Project risk score badge */}
          {results.projectRiskScore != null && projectRiskColor && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold tabular-nums',
                  projectRiskColor.bg, projectRiskColor.border, projectRiskColor.color,
                )}>
                  <Shield className="h-3 w-3" />
                  {results.projectRiskScore.toFixed(1)}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Project Risk Score (0–10)</p>
              </TooltipContent>
            </Tooltip>
          )}
          <div className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md border',
            gradeCfg.bg, gradeCfg.border,
          )}>
            <span className={cn('text-base font-bold leading-none', gradeCfg.color)}>
              {results.healthGrade}
            </span>
            <div className="flex flex-col">
              <span className={cn('text-[10px] leading-tight font-medium', gradeCfg.color)}>{gradeCfg.label}</span>
              <span className="text-[9px] text-text-muted leading-tight">{results.healthScore}/100</span>
            </div>
          </div>
        </div>
      </div>

      {/* Risk distribution mini bar */}
      {riskDist && riskDistTotal > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] text-text-muted">Risk Distribution</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-foreground/5 border border-foreground/[0.06]">
            {riskDist.critical > 0 && (
              <div
                className="bg-red-500 transition-all"
                style={{ width: `${(riskDist.critical / riskDistTotal) * 100}%` }}
                title={`Critical: ${riskDist.critical}`}
              />
            )}
            {riskDist.high > 0 && (
              <div
                className="bg-orange-500 transition-all"
                style={{ width: `${(riskDist.high / riskDistTotal) * 100}%` }}
                title={`High: ${riskDist.high}`}
              />
            )}
            {riskDist.medium > 0 && (
              <div
                className="bg-amber-500 transition-all"
                style={{ width: `${(riskDist.medium / riskDistTotal) * 100}%` }}
                title={`Medium: ${riskDist.medium}`}
              />
            )}
            {riskDist.low > 0 && (
              <div
                className="bg-blue-500 transition-all"
                style={{ width: `${(riskDist.low / riskDistTotal) * 100}%` }}
                title={`Low: ${riskDist.low}`}
              />
            )}
          </div>
          <div className="flex gap-3 mt-1">
            {riskDist.critical > 0 && <span className="text-[9px] text-red-400">{riskDist.critical} critical risk</span>}
            {riskDist.high > 0 && <span className="text-[9px] text-orange-400">{riskDist.high} high risk</span>}
            {riskDist.medium > 0 && <span className="text-[9px] text-amber-400">{riskDist.medium} medium risk</span>}
            {riskDist.low > 0 && <span className="text-[9px] text-blue-400">{riskDist.low} low risk</span>}
          </div>
        </div>
      )}

      {/* Meta row: languages, rules, files */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted mb-3">
        <span>{results.scannedFiles} files scanned</span>
        <span>{results.rulesEvaluated} rules evaluated</span>
        {results.languagesDetected.length > 0 && (
          <span>{results.languagesDetected.join(', ')}</span>
        )}
      </div>

      {/* Metrics cards: Security Grade, Quality Grade, Issues/KLOC, Suppressions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {/* Security Grade */}
        {(() => {
          const cfg = GRADE_CONFIG[results.securityGrade]
          return (
            <div className={cn('rounded-lg border p-2 text-center', cfg.bg, cfg.border)}>
              <p className={cn('text-lg font-bold leading-none', cfg.color)}>{results.securityGrade}</p>
              <p className="text-[10px] text-text-muted mt-1">Security</p>
            </div>
          )
        })()}
        {/* Quality Grade */}
        {(() => {
          const cfg = GRADE_CONFIG[results.qualityGrade]
          return (
            <div className={cn('rounded-lg border p-2 text-center', cfg.bg, cfg.border)}>
              <p className={cn('text-lg font-bold leading-none', cfg.color)}>{results.qualityGrade}</p>
              <p className="text-[10px] text-text-muted mt-1">Quality</p>
            </div>
          )
        })()}
        {/* Issues per KLOC */}
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-2 text-center">
          <p className="text-lg font-bold leading-none text-text-primary tabular-nums">
            {results.issuesPerKloc.toFixed(1)}
          </p>
          <p className="text-[10px] text-text-muted mt-1">Issues / KLOC</p>
        </div>
        {/* Suppressions */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-2 text-center cursor-default">
              <p className="text-lg font-bold leading-none text-text-primary tabular-nums">
                {results.suppressionCount}
              </p>
              <p className="text-[10px] text-text-muted mt-1">Suppressions</p>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Issues suppressed via inline comments (e.g. <code>// repolens-ignore</code>)</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Batch action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Validate Critical button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onBatchValidate}
              disabled={!hasValidApiKey || criticalCount === 0 || validationProgress.inProgress}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors',
                'border-foreground/[0.06] bg-foreground/[0.02]',
                'hover:bg-foreground/[0.06] hover:border-foreground/10',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-foreground/[0.02]',
              )}
            >
              {validationProgress.inProgress ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              {validationProgress.inProgress
                ? `Validating ${validationProgress.completed}/${validationProgress.total}…`
                : 'Validate Critical'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">
              {!hasValidApiKey
                ? 'Configure an AI API key in Settings to use validation'
                : criticalCount === 0
                  ? 'No critical/high severity issues to validate'
                  : `Validate ${criticalCount} critical & warning issues with AI`}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Show All Fixes button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onBatchGenerateFixes}
              disabled={filteredIssueCount === 0 || fixProgress.inProgress}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors',
                'border-foreground/[0.06] bg-foreground/[0.02]',
                'hover:bg-foreground/[0.06] hover:border-foreground/10',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-foreground/[0.02]',
              )}
            >
              {fixProgress.inProgress ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Wrench className="h-3 w-3" />
              )}
              {fixProgress.inProgress
                ? `Generating ${fixProgress.completed}/${fixProgress.total}…`
                : 'Show All Fixes'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">
              {filteredIssueCount === 0
                ? 'No issues to generate fixes for'
                : `Generate fix suggestions for ${filteredIssueCount} visible issues`}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Cancel button (shown only during batch operations) */}
        {validationProgress.inProgress && (
          <button
            onClick={onCancelBatch}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-red-500/20 bg-red-500/5 text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        )}

        {/* Completion summary badges */}
        {!validationProgress.inProgress && validationProgress.completed > 0 && (
          <span className="text-[10px] text-text-muted tabular-nums">
            Validated {validationProgress.completed}
            {validationProgress.failed > 0 && (
              <span className="text-red-400"> ({validationProgress.failed} failed)</span>
            )}
          </span>
        )}
        {!fixProgress.inProgress && fixProgress.completed > 0 && (
          <span className="text-[10px] text-text-muted tabular-nums">
            {fixProgress.completed - fixProgress.failed} fixes found
          </span>
        )}
      </div>
    </>
  )
}
