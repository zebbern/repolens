"use client"

import type { CodeIssue, DiffLine, FixSuggestion, ValidationResult } from '@/lib/code/issue-scanner'
import { SEVERITY_CONFIG, VERDICT_CONFIG } from './constants'
import { TaintFlowDiagram } from './taint-flow-diagram'
import { cn } from '@/lib/utils'
import { Wrench, Sparkles, Loader2, ExternalLink } from 'lucide-react'

interface IssueDetailsProps {
  issue: CodeIssue
  showFix: boolean
  fix: FixSuggestion | null | undefined
  validationResult: ValidationResult | undefined
  isValidating: boolean
  hasValidApiKey: boolean
  onShowFix: (issue: CodeIssue) => void
  onValidate: (issue: CodeIssue) => void
}

export function IssueDetails({
  issue, showFix, fix, validationResult, isValidating,
  hasValidApiKey, onShowFix, onValidate,
}: IssueDetailsProps) {
  return (
    <div className="px-3 pb-3 flex flex-col gap-2.5 ml-5">
      {/* Description */}
      <p className="text-[11px] text-text-muted leading-relaxed">{issue.description}</p>

      {/* Taint flow visualization */}
      {issue.taintFlow && (
        <TaintFlowDiagram flow={issue.taintFlow} />
      )}

      {/* Code snippet */}
      <div className="rounded bg-foreground/5 border border-foreground/[0.04] px-2.5 py-1.5 overflow-x-auto">
        <code className="text-[10px] font-mono text-text-secondary whitespace-pre">{issue.snippet}</code>
      </div>

      {/* Suggestion */}
      {issue.suggestion && (
        <div className="rounded bg-emerald-500/5 border border-emerald-500/10 px-2.5 py-1.5">
          <p className="text-[10px] text-emerald-400/90 leading-relaxed">
            <span className="font-medium">Fix: </span>
            {issue.suggestion}
          </p>
        </div>
      )}

      {/* Fix suggestion diff */}
      {showFix && fix !== undefined && (() => {
        if (!fix) return (
          <div className="rounded bg-foreground/5 border border-foreground/[0.04] px-2.5 py-1.5">
            <p className="text-[10px] text-text-muted">No automated fix available for this issue.</p>
          </div>
        )
        return (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] text-text-muted font-medium">Suggested Fix</p>
            <div className="rounded bg-foreground/5 border border-foreground/[0.04] overflow-hidden">
              {fix.diffLines.map((dl: DiffLine, i: number) => (
                <div
                  key={`${dl.lineNumber}-${dl.type}-${i}`}
                  className={cn(
                    'px-2.5 py-0.5 text-[10px] font-mono whitespace-pre border-l-2',
                    dl.type === 'add' && 'bg-emerald-500/10 border-l-emerald-500 text-emerald-400',
                    dl.type === 'remove' && 'bg-red-500/10 border-l-red-500 text-red-400 line-through',
                    dl.type === 'context' && 'bg-transparent border-l-transparent text-text-muted',
                  )}
                >
                  <span className="text-text-muted/50 select-none mr-2 inline-block w-4 text-right">
                    {dl.type === 'add' ? '+' : dl.type === 'remove' ? '-' : ' '}
                  </span>
                  {dl.content}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-emerald-400/80 leading-relaxed">{fix.explanation}</p>
          </div>
        )
      })()}

      {/* Action buttons: Show Fix + Verify with AI */}
      <div className="flex gap-2 items-center">
        <button
          onClick={() => onShowFix(issue)}
          className={cn(
            'text-[10px] px-2 py-1 rounded-md border transition-colors flex items-center gap-1',
            showFix
              ? 'bg-foreground/10 border-foreground/20 text-text-primary'
              : 'border-foreground/[0.06] text-text-muted hover:text-text-secondary hover:bg-foreground/5',
          )}
        >
          <Wrench className="h-2.5 w-2.5" />
          {showFix ? 'Hide Fix' : 'Show Fix'}
        </button>

        {!validationResult && (
          <button
            onClick={() => onValidate(issue)}
            disabled={!hasValidApiKey || isValidating}
            className={cn(
              'text-[10px] px-2 py-1 rounded-md border transition-colors flex items-center gap-1',
              hasValidApiKey
                ? 'border-violet-500/20 text-violet-400 hover:bg-violet-500/10'
                : 'border-foreground/[0.06] text-text-muted/50 cursor-not-allowed',
            )}
            title={hasValidApiKey ? 'Verify this finding with AI' : 'Configure an API key to use AI validation'}
          >
            {isValidating ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Sparkles className="h-2.5 w-2.5" />
            )}
            <span role="status" aria-live="polite">
              {isValidating ? 'Verifying…' : 'Verify with AI'}
            </span>
          </button>
        )}
      </div>

      {/* AI Validation result */}
      {validationResult && (() => {
        const verdictCfg = VERDICT_CONFIG[validationResult.verdict] ?? VERDICT_CONFIG['uncertain']
        return (
          <div className={cn('rounded-md border p-2.5 flex flex-col gap-1.5', verdictCfg.bg, verdictCfg.border)}>
            <div className="flex items-center gap-2">
              <Sparkles className={cn('h-3 w-3', verdictCfg.color)} />
              <span className={cn('text-[10px] font-bold', verdictCfg.color)}>{verdictCfg.label}</span>
              <span className="text-[9px] text-text-muted ml-auto">Confidence: {validationResult.confidence}</span>
            </div>
            <p className="text-[10px] text-text-muted leading-relaxed">{validationResult.reasoning}</p>
            {validationResult.suggestedSeverity && validationResult.suggestedSeverity !== issue.severity && (
              <p className="text-[9px] text-text-muted">
                Suggested severity: <span className={cn('font-medium', SEVERITY_CONFIG[validationResult.suggestedSeverity].color)}>{SEVERITY_CONFIG[validationResult.suggestedSeverity].label}</span>
              </p>
            )}
          </div>
        )
      })()}

      {/* Reference tags */}
      {(issue.cwe || issue.owasp || issue.learnMoreUrl) && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {issue.cwe && (
            <a
              href={`https://cwe.mitre.org/data/definitions/${issue.cwe.replace('CWE-', '')}.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-colors font-mono flex items-center gap-1"
            >
              {issue.cwe}
              <ExternalLink className="h-2 w-2" />
            </a>
          )}
          {issue.owasp && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 font-mono">
              {issue.owasp}
            </span>
          )}
          {issue.learnMoreUrl && (
            <a
              href={issue.learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-text-muted hover:text-text-secondary flex items-center gap-0.5 transition-colors"
            >
              Learn more
              <ExternalLink className="h-2 w-2" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
