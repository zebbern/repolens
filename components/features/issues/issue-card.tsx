"use client"

import type { CodeIssue, FixSuggestion, ValidationResult } from '@/lib/code/issue-scanner'
import { SEVERITY_CONFIG, getRiskScoreColor } from './constants'
import { IssueDetails } from './issue-details'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface IssueCardProps {
  issue: CodeIssue
  isExpanded: boolean
  onToggle: (id: string) => void
  onNavigateToFile?: (path: string) => void
  showFix: boolean
  fix: FixSuggestion | null | undefined
  validationResult: ValidationResult | undefined
  isValidating: boolean
  hasValidApiKey: boolean
  onShowFix: (issue: CodeIssue) => void
  onValidate: (issue: CodeIssue) => void
}

export function IssueCard({
  issue, isExpanded, onToggle, onNavigateToFile,
  showFix, fix, validationResult, isValidating,
  hasValidApiKey, onShowFix, onValidate,
}: IssueCardProps) {
  const sev = SEVERITY_CONFIG[issue.severity]
  const SevIcon = sev.icon

  return (
    <div className={cn('rounded-md border', sev.borderColor, sev.bgColor)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggle(issue.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(issue.id) } }}
        aria-expanded={isExpanded}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
      >
        <SevIcon className={cn('h-3 w-3 shrink-0', sev.color)} />
        <span className="text-xs text-text-primary flex-1 truncate">{issue.title}</span>
        {/* Risk score badge */}
        {issue.riskScore != null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(
                'text-[9px] px-1.5 py-0.5 rounded-full border font-bold tabular-nums shrink-0',
                getRiskScoreColor(issue.riskScore).bg,
                getRiskScoreColor(issue.riskScore).border,
                getRiskScoreColor(issue.riskScore).color,
              )}>
                {issue.riskScore.toFixed(1)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs font-mono">{issue.cvssVector ?? `Risk: ${issue.riskScore.toFixed(1)}/10`}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* CWE badge inline */}
        {issue.cwe && (
          <span className="text-[9px] px-1 py-px rounded bg-foreground/4 border border-foreground/6 text-text-muted font-mono shrink-0">
            {issue.cwe}
          </span>
        )}
        {issue.line > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigateToFile?.(issue.file)
            }}
            className="text-[10px] text-text-muted hover:text-text-secondary font-mono tabular-nums shrink-0"
            title="Open in Code tab"
          >
            L{issue.line}
          </button>
        )}
      </div>

      {isExpanded && (
        <IssueDetails
          issue={issue}
          showFix={showFix}
          fix={fix}
          validationResult={validationResult}
          isValidating={isValidating}
          hasValidApiKey={hasValidApiKey}
          onShowFix={onShowFix}
          onValidate={onValidate}
        />
      )}
    </div>
  )
}
