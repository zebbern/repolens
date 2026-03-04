"use client"

import { useState, useMemo, useCallback, useRef } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import type { FullAnalysis } from '@/lib/code/import-parser'
import {
  scanIssues,
  generateFix,
  validateFinding,
  type ScanResults,
  type CodeIssue,
  type IssueSeverity,
  type IssueCategory,
  type HealthGrade,
  type FixSuggestion,
  type DiffLine,
  type ValidationResult,
} from '@/lib/code/issue-scanner'
import { useRepository } from '@/providers'
import { useAPIKeys } from '@/providers/api-keys-provider'
import { cn } from '@/lib/utils'
import {
  Shield, AlertTriangle, Info, ChevronRight, ChevronDown, FileCode2,
  Bug, Loader2, ShieldAlert, Wrench, Activity, ExternalLink, Sparkles, ShieldCheck,
} from 'lucide-react'
import { ComplianceDashboard } from './compliance-dashboard'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface IssuesPanelProps {
  codeIndex: CodeIndex
  onNavigateToFile?: (path: string) => void
}

const SEVERITY_CONFIG: Record<IssueSeverity, { label: string; color: string; bgColor: string; borderColor: string; icon: typeof AlertTriangle }> = {
  critical: { label: 'Critical', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/20', icon: ShieldAlert },
  warning: { label: 'Warning', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20', icon: AlertTriangle },
  info: { label: 'Info', color: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/20', icon: Info },
}

const CATEGORY_CONFIG: Record<IssueCategory, { label: string; icon: typeof Shield }> = {
  'security': { label: 'Security', icon: Shield },
  'bad-practice': { label: 'Bad Practices', icon: Wrench },
  'reliability': { label: 'Reliability', icon: Activity },
}

const GRADE_CONFIG: Record<HealthGrade, { color: string; bg: string; border: string; label: string }> = {
  A: { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Excellent' },
  B: { color: 'text-teal-700 dark:text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20', label: 'Good' },
  C: { color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Fair' },
  D: { color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', label: 'Poor' },
  F: { color: 'text-red-700 dark:text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'Critical' },
}

type ViewMode = 'issues' | 'compliance'
type FilterMode = 'all' | IssueSeverity | IssueCategory

const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  'true-positive': { label: 'True Positive', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  'false-positive': { label: 'False Positive', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  'uncertain': { label: 'Uncertain', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
}

function getRiskScoreColor(score: number): { color: string; bg: string; border: string } {
  if (score >= 8.0) return { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' }
  if (score >= 5.0) return { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' }
  if (score >= 3.0) return { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' }
  return { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' }
}

export function IssuesPanel({ codeIndex, onNavigateToFile }: IssuesPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('issues')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [hideInfo, setHideInfo] = useState(true)
  const [hideLowConfidence, setHideLowConfidence] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set())
  const [fixCache, setFixCache] = useState<Map<string, FixSuggestion | null>>(new Map())
  const [showFix, setShowFix] = useState<Set<string>>(new Set())
  const [validationResults, setValidationResults] = useState<Map<string, ValidationResult>>(new Map())
  const [validatingIssues, setValidatingIssues] = useState<Set<string>>(new Set())

  // Refs to stabilize useCallback identity — guard checks read from ref, UI updates use setState
  const fixCacheRef = useRef(fixCache)
  fixCacheRef.current = fixCache
  const validationResultsRef = useRef(validationResults)
  validationResultsRef.current = validationResults
  const validatingIssuesRef = useRef(validatingIssues)
  validatingIssuesRef.current = validatingIssues

  const { codebaseAnalysis: analysis } = useRepository()
  const { selectedProvider, selectedModel, apiKeys } = useAPIKeys()

  const results: ScanResults | null = useMemo(() => {
    if (codeIndex.totalFiles === 0) return null
    return scanIssues(codeIndex, analysis)
  }, [codeIndex, analysis])

  const handleShowFix = useCallback((issue: CodeIssue) => {
    setShowFix(prev => {
      const next = new Set(prev)
      if (next.has(issue.id)) {
        next.delete(issue.id)
        return next
      }
      next.add(issue.id)
      return next
    })

    if (!fixCacheRef.current.has(issue.id)) {
      const file = codeIndex.files.get(issue.file)
      if (file) {
        const fix = generateFix(issue, file.content)
        setFixCache(prev => new Map(prev).set(issue.id, fix))
      } else {
        setFixCache(prev => new Map(prev).set(issue.id, null))
      }
    }
  }, [codeIndex.files])

  const handleValidate = useCallback(async (issue: CodeIssue) => {
    if (validationResultsRef.current.has(issue.id) || validatingIssuesRef.current.has(issue.id)) return
    if (!selectedProvider || !selectedModel) return

    const apiKey = apiKeys[selectedProvider]?.key
    if (!apiKey) return

    setValidatingIssues(prev => new Set(prev).add(issue.id))

    try {
      const file = codeIndex.files.get(issue.file)
      const fileContent = file?.content ?? ''
      const result = await validateFinding(issue, fileContent, {
        provider: selectedProvider,
        model: selectedModel.id,
        apiKey,
      })
      setValidationResults(prev => new Map(prev).set(issue.id, result))
    } catch (err) {
      setValidationResults(prev => new Map(prev).set(issue.id, {
        issueId: issue.id,
        verdict: 'uncertain',
        confidence: 'low',
        reasoning: err instanceof Error ? err.message : 'Validation failed',
      }))
    } finally {
      setValidatingIssues(prev => {
        const next = new Set(prev)
        next.delete(issue.id)
        return next
      })
    }
  }, [selectedProvider, selectedModel, apiKeys, codeIndex.files])

  if (codeIndex.totalFiles === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-text-muted">
          <Shield className="h-6 w-6" />
          <p className="text-sm font-medium">Load a repository to see code issues</p>
          <p className="text-xs text-center max-w-[240px]">Enter a GitHub repository URL to analyze code quality</p>
        </div>
      </div>
    )
  }

  if (!results) return null

  const filteredIssues = results.issues.filter(issue => {
    // Apply severity/confidence visibility filters
    if (hideInfo && issue.severity === 'info') return false
    if (hideLowConfidence && issue.confidence === 'low') return false
    // Apply category/severity filter mode
    if (filter === 'all') return true
    if (filter === 'critical' || filter === 'warning' || filter === 'info') return issue.severity === filter
    return issue.category === filter
  })

  // Compute filtered counts for summary display
  const filteredSummary = {
    total: filteredIssues.length,
    critical: filteredIssues.filter(i => i.severity === 'critical').length,
    warning: filteredIssues.filter(i => i.severity === 'warning').length,
    info: filteredIssues.filter(i => i.severity === 'info').length,
    bySecurity: filteredIssues.filter(i => i.category === 'security').length,
    byBadPractice: filteredIssues.filter(i => i.category === 'bad-practice').length,
    byReliability: filteredIssues.filter(i => i.category === 'reliability').length,
  }

  const groupedByFile = new Map<string, CodeIssue[]>()
  for (const issue of filteredIssues) {
    const existing = groupedByFile.get(issue.file) || []
    existing.push(issue)
    groupedByFile.set(issue.file, existing)
  }

  const autoExpand = groupedByFile.size <= 5 && groupedByFile.size > 0
  const isGroupExpanded = (file: string) => autoExpand ? !expandedGroups.has(file) : expandedGroups.has(file)

  const toggleGroup = (file: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const toggleIssue = (id: string) => {
    setExpandedIssues(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const { summary } = results
  const gradeCfg = GRADE_CONFIG[results.healthGrade]
  const projectRiskColor = results.projectRiskScore != null ? getRiskScoreColor(results.projectRiskScore) : null
  const riskDist = results.riskDistribution
  const riskDistTotal = riskDist ? riskDist.critical + riskDist.high + riskDist.medium + riskDist.low : 0

  const hasValidApiKey = Boolean(selectedProvider && selectedModel && apiKeys[selectedProvider]?.key)

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-col h-full">
      {/* View toggle: Issues / Compliance */}
      <div className="flex items-center gap-0.5 px-4 pt-3 pb-0" role="tablist" aria-label="View mode">
        <button
          onClick={() => setViewMode('issues')}
          role="tab"
          aria-selected={viewMode === 'issues'}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
            viewMode === 'issues'
              ? 'bg-foreground/10 text-text-primary'
              : 'text-text-muted hover:text-text-secondary hover:bg-foreground/5',
          )}
        >
          <Bug className="h-3 w-3" />
          Issues
        </button>
        <button
          onClick={() => setViewMode('compliance')}
          role="tab"
          aria-selected={viewMode === 'compliance'}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
            viewMode === 'compliance'
              ? 'bg-foreground/10 text-text-primary'
              : 'text-text-muted hover:text-text-secondary hover:bg-foreground/5',
          )}
        >
          <ShieldCheck className="h-3 w-3" />
          Compliance
        </button>
      </div>

      {/* Compliance view */}
      {viewMode === 'compliance' ? (
        <ComplianceDashboard codeIndex={codeIndex} scanResults={results} />
      ) : (
      <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-foreground/[0.06]">
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

        {/* Summary badges */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {filteredSummary.critical > 0 && (
            <button
              onClick={() => setFilter(f => f === 'critical' ? 'all' : 'critical')}
              aria-pressed={filter === 'critical'}
              className={cn(
                'rounded-lg border p-2 text-left transition-colors',
                filter === 'critical' ? 'border-red-500/40 bg-red-500/15' : 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10'
              )}
            >
              <p className="text-lg font-bold text-red-400 tabular-nums">{filteredSummary.critical}</p>
              <p className="text-[10px] text-red-400/70">Critical</p>
            </button>
          )}
          {filteredSummary.warning > 0 && (
            <button
              onClick={() => setFilter(f => f === 'warning' ? 'all' : 'warning')}
              aria-pressed={filter === 'warning'}
              className={cn(
                'rounded-lg border p-2 text-left transition-colors',
                filter === 'warning' ? 'border-amber-500/40 bg-amber-500/15' : 'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10'
              )}
            >
              <p className="text-lg font-bold text-amber-400 tabular-nums">{filteredSummary.warning}</p>
              <p className="text-[10px] text-amber-400/70">Warnings</p>
            </button>
          )}
          {filteredSummary.info > 0 && (
            <button
              onClick={() => setFilter(f => f === 'info' ? 'all' : 'info')}
              aria-pressed={filter === 'info'}
              className={cn(
                'rounded-lg border p-2 text-left transition-colors',
                filter === 'info' ? 'border-blue-500/40 bg-blue-500/15' : 'border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10'
              )}
            >
              <p className="text-lg font-bold text-blue-400 tabular-nums">{filteredSummary.info}</p>
              <p className="text-[10px] text-blue-400/70">Info</p>
            </button>
          )}
        </div>

        {/* Category filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
              filter === 'all'
                ? 'bg-foreground/10 border-foreground/20 text-text-primary'
                : 'border-foreground/[0.06] text-text-muted hover:text-text-secondary hover:bg-foreground/5'
            )}
          >
            All ({filteredSummary.total})
          </button>
          {(Object.keys(CATEGORY_CONFIG) as IssueCategory[]).map(cat => {
            const count = cat === 'security' ? filteredSummary.bySecurity : cat === 'bad-practice' ? filteredSummary.byBadPractice : filteredSummary.byReliability
            if (count === 0) return null
            const cfg = CATEGORY_CONFIG[cat]
            return (
              <button
                key={cat}
                onClick={() => setFilter(f => f === cat ? 'all' : cat)}
                aria-pressed={filter === cat}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1',
                  filter === cat
                    ? 'bg-foreground/10 border-foreground/20 text-text-primary'
                    : 'border-foreground/[0.06] text-text-muted hover:text-text-secondary hover:bg-foreground/5'
                )}
              >
                <cfg.icon className="h-2.5 w-2.5" />
                {cfg.label} ({count})
              </button>
            )
          })}
        </div>

        {/* Visibility toggles */}
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-foreground/[0.04]">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!hideInfo}
              onChange={() => setHideInfo(h => !h)}
              className="h-3 w-3 rounded border-foreground/20 accent-blue-500"
            />
            <span className="text-[10px] text-text-muted">Show info</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!hideLowConfidence}
              onChange={() => setHideLowConfidence(h => !h)}
              className="h-3 w-3 rounded border-foreground/20 accent-blue-500"
            />
            <span className="text-[10px] text-text-muted">Show low confidence</span>
          </label>
          {(hideInfo || hideLowConfidence) && filteredSummary.total < summary.total && (
            <span className="text-[9px] text-text-muted/60 ml-auto">
              {summary.total - filteredSummary.total} hidden
            </span>
          )}
        </div>
      </div>

      {/* Issues list */}
      <div className="flex-1 overflow-y-auto">
        {filteredIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            {summary.total === 0 ? (
              <>
                <div className="h-14 w-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Shield className="h-7 w-7 text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-text-secondary">Clean Codebase</p>
                <p className="text-xs text-text-muted/70 text-center max-w-xs leading-relaxed">
                  No security risks, bad practices, or reliability issues detected across {results.scannedFiles} files
                  {results.languagesDetected.length > 0 && ` (${results.languagesDetected.join(', ')})`}.
                </p>
              </>
            ) : (
              <>
                <Shield className="h-8 w-8 opacity-40" />
                <p className="text-sm">No issues match this filter</p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Overflow notice */}
            {results.ruleOverflow.size > 0 && (
              <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/[0.06]">
                <p className="text-[11px] text-text-muted">
                  {'Showing top 15 per rule. Additional matches: '}
                  {Array.from(results.ruleOverflow.entries()).map(([ruleId, count], i) => (
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
                      {fileIssues.map(issue => {
                        const isIssueExpanded = expandedIssues.has(issue.id)
                        const sev = SEVERITY_CONFIG[issue.severity]
                        const SevIcon = sev.icon

                        return (
                          <div key={issue.id} className={cn('rounded-md border', sev.borderColor, sev.bgColor)}>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleIssue(issue.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIssue(issue.id) } }}
                              aria-expanded={isIssueExpanded}
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
                                <span className="text-[9px] px-1 py-px rounded bg-foreground/[0.04] border border-foreground/[0.06] text-text-muted font-mono shrink-0">
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

                            {isIssueExpanded && (
                              <div className="px-3 pb-3 flex flex-col gap-2.5 ml-5">
                                {/* Description */}
                                <p className="text-[11px] text-text-muted leading-relaxed">{issue.description}</p>

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
                                {showFix.has(issue.id) && fixCache.has(issue.id) && (() => {
                                  const fix = fixCache.get(issue.id)
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
                                    onClick={() => handleShowFix(issue)}
                                    className={cn(
                                      'text-[10px] px-2 py-1 rounded-md border transition-colors flex items-center gap-1',
                                      showFix.has(issue.id)
                                        ? 'bg-foreground/10 border-foreground/20 text-text-primary'
                                        : 'border-foreground/[0.06] text-text-muted hover:text-text-secondary hover:bg-foreground/5',
                                    )}
                                  >
                                    <Wrench className="h-2.5 w-2.5" />
                                    {showFix.has(issue.id) ? 'Hide Fix' : 'Show Fix'}
                                  </button>

                                  {!validationResults.has(issue.id) && (
                                    <button
                                      onClick={() => handleValidate(issue)}
                                      disabled={!hasValidApiKey || validatingIssues.has(issue.id)}
                                      className={cn(
                                        'text-[10px] px-2 py-1 rounded-md border transition-colors flex items-center gap-1',
                                        hasValidApiKey
                                          ? 'border-violet-500/20 text-violet-400 hover:bg-violet-500/10'
                                          : 'border-foreground/[0.06] text-text-muted/50 cursor-not-allowed',
                                      )}
                                      title={hasValidApiKey ? 'Verify this finding with AI' : 'Configure an API key to use AI validation'}
                                    >
                                      {validatingIssues.has(issue.id) ? (
                                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                      ) : (
                                        <Sparkles className="h-2.5 w-2.5" />
                                      )}
                                      <span role="status" aria-live="polite">
                                        {validatingIssues.has(issue.id) ? 'Verifying…' : 'Verify with AI'}
                                      </span>
                                    </button>
                                  )}
                                </div>

                                {/* AI Validation result */}
                                {validationResults.has(issue.id) && (() => {
                                  const vr = validationResults.get(issue.id)!
                                  const verdictCfg = VERDICT_CONFIG[vr.verdict] ?? VERDICT_CONFIG['uncertain']
                                  return (
                                    <div className={cn('rounded-md border p-2.5 flex flex-col gap-1.5', verdictCfg.bg, verdictCfg.border)}>
                                      <div className="flex items-center gap-2">
                                        <Sparkles className={cn('h-3 w-3', verdictCfg.color)} />
                                        <span className={cn('text-[10px] font-bold', verdictCfg.color)}>{verdictCfg.label}</span>
                                        <span className="text-[9px] text-text-muted ml-auto">Confidence: {vr.confidence}</span>
                                      </div>
                                      <p className="text-[10px] text-text-muted leading-relaxed">{vr.reasoning}</p>
                                      {vr.suggestedSeverity && vr.suggestedSeverity !== issue.severity && (
                                        <p className="text-[9px] text-text-muted">
                                          Suggested severity: <span className={cn('font-medium', SEVERITY_CONFIG[vr.suggestedSeverity].color)}>{SEVERITY_CONFIG[vr.suggestedSeverity].label}</span>
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
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      </>
      )}
    </div>
    </TooltipProvider>
  )
}
