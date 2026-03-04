"use client"

import type { CodeIssue, FixSuggestion, ValidationResult } from '@/lib/code/issue-scanner'
import { SEVERITY_CONFIG } from './constants'
import { IssueCard } from './issue-card'
import { cn } from '@/lib/utils'
import { Shield, ChevronRight, ChevronDown, FileCode2 } from 'lucide-react'

interface IssueListProps {
  groupedByFile: Map<string, CodeIssue[]>
  isGroupExpanded: (file: string) => boolean
  toggleGroup: (file: string) => void
  expandedIssues: Set<string>
  toggleIssue: (id: string) => void
  onNavigateToFile?: (path: string) => void
  ruleOverflow: Map<string, number>
  scannedFiles: number
  languagesDetected: string[]
  totalIssueCount: number
  filteredIssueCount: number
  showFix: Set<string>
  fixCache: Map<string, FixSuggestion | null>
  validationResults: Map<string, ValidationResult>
  validatingIssues: Set<string>
  hasValidApiKey: boolean
  onShowFix: (issue: CodeIssue) => void
  onValidate: (issue: CodeIssue) => void
}

export function IssueList({
  groupedByFile, isGroupExpanded, toggleGroup,
  expandedIssues, toggleIssue, onNavigateToFile,
  ruleOverflow, scannedFiles, languagesDetected,
  totalIssueCount, filteredIssueCount,
  showFix, fixCache, validationResults, validatingIssues,
  hasValidApiKey, onShowFix, onValidate,
}: IssueListProps) {
  if (filteredIssueCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
        {totalIssueCount === 0 ? (
          <>
            <div className="h-14 w-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Shield className="h-7 w-7 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-text-secondary">Clean Codebase</p>
            <p className="text-xs text-text-muted/70 text-center max-w-xs leading-relaxed">
              No security risks, bad practices, or reliability issues detected across {scannedFiles} files
              {languagesDetected.length > 0 && ` (${languagesDetected.join(', ')})`}.
            </p>
          </>
        ) : (
          <>
            <Shield className="h-8 w-8 opacity-40" />
            <p className="text-sm">No issues match this filter</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Overflow notice */}
      {ruleOverflow.size > 0 && (
        <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/[0.06]">
          <p className="text-[11px] text-text-muted">
            {'Showing top 15 per rule. Additional matches: '}
            {Array.from(ruleOverflow.entries()).map(([ruleId, count], i) => (
              <span key={ruleId}>
                {i > 0 && ', '}
                <span className="text-text-secondary">{ruleId}</span>
                <span className="text-text-muted/60"> (+{count})</span>
              </span>
            ))}
          </p>
        </div>
      )}

      {Array.from(groupedByFile.entries()).map(([file, fileIssues]) => {
        const isExpanded = isGroupExpanded(file)
        const worstSeverity = fileIssues.some(i => i.severity === 'critical')
          ? 'critical'
          : fileIssues.some(i => i.severity === 'warning')
            ? 'warning'
            : 'info'
        const sevCfg = SEVERITY_CONFIG[worstSeverity]

        return (
          <div key={file} className="border-b border-foreground/[0.04]">
            {/* File header */}
            <button
              onClick={() => toggleGroup(file)}
              aria-expanded={isExpanded}
              className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-foreground/[0.02] transition-colors text-left"
            >
              {isExpanded
                ? <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
                : <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
              }
              <FileCode2 className="h-3.5 w-3.5 text-text-muted shrink-0" />
              <span className="text-xs text-text-secondary font-mono truncate flex-1">{file}</span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full tabular-nums', sevCfg.bgColor, sevCfg.borderColor, sevCfg.color, 'border')}>
                {fileIssues.length}
              </span>
            </button>

            {/* File issues */}
            {isExpanded && (
              <div className="pl-4 pr-3 pb-2 flex flex-col gap-1">
                {fileIssues.map(issue => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    isExpanded={expandedIssues.has(issue.id)}
                    onToggle={toggleIssue}
                    onNavigateToFile={onNavigateToFile}
                    showFix={showFix.has(issue.id)}
                    fix={fixCache.get(issue.id)}
                    validationResult={validationResults.get(issue.id)}
                    isValidating={validatingIssues.has(issue.id)}
                    hasValidApiKey={hasValidApiKey}
                    onShowFix={onShowFix}
                    onValidate={onValidate}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
