"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import {
  scanIssuesAsync,
  generateFix,
  validateFinding,
  type ScanResults,
  type CodeIssue,
  type FixSuggestion,
  type ValidationResult,
} from '@/lib/code/issue-scanner'
import { useRepository } from '@/providers'
import { useAPIKeys } from '@/providers/api-keys-provider'
import { useBatchOperations } from '@/hooks/use-batch-operations'
import { cn } from '@/lib/utils'
import { Shield, Bug, ShieldCheck } from 'lucide-react'
import { ComplianceDashboard } from './compliance-dashboard'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { FilterMode, ViewMode } from './issue-types'
import { isSupplyChainIssue, isStructuralIssue } from './issue-types'
import { IssueSummary } from './issue-summary'
import { IssueFilters } from './issue-filters'
import { IssueList } from './issue-list'

interface IssuesPanelProps {
  codeIndex: CodeIndex
  onNavigateToFile?: (path: string) => void
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

  const [results, setResults] = useState<ScanResults | null>(null)
  const [scanLoading, setScanLoading] = useState(false)

  useEffect(() => {
    if (codeIndex.totalFiles === 0) {
      setResults(null)
      return
    }

    let stale = false
    setScanLoading(true)

    scanIssuesAsync(codeIndex, analysis, { isStale: () => stale })
      .then(scanResults => {
        if (stale) return
        setResults(scanResults)
      })
      .catch(err => {
        if (stale) return
        console.warn('[issues-panel] Scanner failed', err)
      })
      .finally(() => {
        if (!stale) setScanLoading(false)
      })

    return () => { stale = true }
  }, [codeIndex, analysis])

  const {
    batchValidate,
    batchGenerateFixes,
    cancelBatch,
    validationProgress,
    fixProgress,
    hasValidApiKey,
  } = useBatchOperations({
    codeIndex,
    selectedProvider,
    selectedModel,
    apiKeys,
    generateFix,
    validateFinding,
    setFixCache,
    setShowFix,
    setValidationResults,
  })

  const handleShowFix = useCallback((issue: CodeIssue) => {
    setShowFix(prev => {
      const next = new Set(prev)
      if (next.has(issue.id)) { next.delete(issue.id); return next }
      next.add(issue.id)
      return next
    })

    if (!fixCacheRef.current.has(issue.id)) {
      const file = codeIndex.files.get(issue.file)
      if (file) {
        setFixCache(prev => new Map(prev).set(issue.id, generateFix(issue, file.content)))
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
      const result = await validateFinding(issue, file?.content ?? '', {
        provider: selectedProvider, model: selectedModel.id, apiKey,
      })
      setValidationResults(prev => new Map(prev).set(issue.id, result))
    } catch (err) {
      setValidationResults(prev => new Map(prev).set(issue.id, {
        issueId: issue.id, verdict: 'uncertain', confidence: 'low',
        reasoning: err instanceof Error ? err.message : 'Validation failed',
      }))
    } finally {
      setValidatingIssues(prev => { const next = new Set(prev); next.delete(issue.id); return next })
    }
  }, [selectedProvider, selectedModel, apiKeys, codeIndex.files])

  const filteredIssues = useMemo(() => {
    if (!results) return []
    return results.issues.filter(issue => {
      if (hideInfo && issue.severity === 'info') return false
      if (hideLowConfidence && issue.confidence === 'low') return false
      if (filter === 'all') return true
      if (filter === 'critical' || filter === 'warning' || filter === 'info') return issue.severity === filter
      if (filter === 'supply-chain') return isSupplyChainIssue(issue)
      if (filter === 'structural') return isStructuralIssue(issue)
      return issue.category === filter
    })
  }, [results, hideInfo, hideLowConfidence, filter])

  const filteredSummary = useMemo(() => ({
    total: filteredIssues.length,
    critical: filteredIssues.filter(i => i.severity === 'critical').length,
    warning: filteredIssues.filter(i => i.severity === 'warning').length,
    info: filteredIssues.filter(i => i.severity === 'info').length,
    bySecurity: filteredIssues.filter(i => i.category === 'security').length,
    byBadPractice: filteredIssues.filter(i => i.category === 'bad-practice').length,
    byReliability: filteredIssues.filter(i => i.category === 'reliability').length,
    bySupplyChain: filteredIssues.filter(i => isSupplyChainIssue(i)).length,
    byStructural: filteredIssues.filter(i => isStructuralIssue(i)).length,
  }), [filteredIssues])

  const groupedByFile = useMemo(() => {
    const map = new Map<string, CodeIssue[]>()
    for (const issue of filteredIssues) {
      const existing = map.get(issue.file) || []
      existing.push(issue)
      map.set(issue.file, existing)
    }
    return map
  }, [filteredIssues])

  const criticalWarningCount = filteredIssues.filter(
    (i) => i.severity === 'critical' || i.severity === 'warning',
  ).length

  const handleBatchValidate = useCallback(() => {
    batchValidate(filteredIssues)
  }, [batchValidate, filteredIssues])

  const handleBatchGenerateFixes = useCallback(() => {
    batchGenerateFixes(filteredIssues)
  }, [batchGenerateFixes, filteredIssues])

  if (codeIndex.totalFiles === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4 text-text-muted animate-in fade-in duration-300">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
            <Shield className="h-6 w-6 text-text-secondary" />
          </div>
          <p className="text-sm font-medium text-text-secondary">No repository loaded</p>
          <p className="text-xs text-center max-w-[260px]">Connect a GitHub repository to scan for security issues, code quality, and best practices</p>
        </div>
      </div>
    )
  }

  if (!results) {
    if (scanLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4 text-text-muted animate-in fade-in duration-300">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
              <Shield className="h-6 w-6 text-text-secondary animate-pulse" />
            </div>
            <p className="text-sm font-medium text-text-secondary">Scanning for issues…</p>
          </div>
        </div>
      )
    }
    return null
  }

  const autoExpand = groupedByFile.size <= 5 && groupedByFile.size > 0
  const isGroupExpanded = (file: string) => autoExpand ? !expandedGroups.has(file) : expandedGroups.has(file)

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) => {
    setter(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  const toggleGroup = toggleSet(setExpandedGroups)
  const toggleIssue = toggleSet(setExpandedIssues)

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-col h-full">
      {/* View toggle: Issues / Compliance */}
      <div className="flex items-center gap-0.5 px-4 pt-3 pb-0" role="tablist" aria-label="View mode">
        {([['issues', Bug, 'Issues'], ['compliance', ShieldCheck, 'Compliance']] as const).map(([mode, Icon, label]) => (
          <button key={mode} onClick={() => setViewMode(mode)} role="tab" aria-selected={viewMode === mode}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              viewMode === mode ? 'bg-foreground/10 text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-foreground/5')}>
            <Icon className="h-3 w-3" />{label}
          </button>
        ))}
      </div>

      {viewMode === 'compliance' ? (
        <ComplianceDashboard codeIndex={codeIndex} scanResults={results} />
      ) : (
      <>
        <div className="px-4 py-3 border-b border-foreground/[0.06]">
          <IssueSummary
            results={results}
            hasValidApiKey={hasValidApiKey}
            filteredIssueCount={filteredIssues.length}
            criticalCount={criticalWarningCount}
            validationProgress={validationProgress}
            fixProgress={fixProgress}
            onBatchValidate={handleBatchValidate}
            onBatchGenerateFixes={handleBatchGenerateFixes}
            onCancelBatch={cancelBatch}
          />
          <IssueFilters
            filter={filter}
            setFilter={setFilter}
            filteredSummary={filteredSummary}
            hideInfo={hideInfo}
            setHideInfo={setHideInfo}
            hideLowConfidence={hideLowConfidence}
            setHideLowConfidence={setHideLowConfidence}
            totalIssueCount={results.summary.total}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          <IssueList
            groupedByFile={groupedByFile}
            isGroupExpanded={isGroupExpanded}
            toggleGroup={toggleGroup}
            expandedIssues={expandedIssues}
            toggleIssue={toggleIssue}
            onNavigateToFile={onNavigateToFile}
            ruleOverflow={results.ruleOverflow}
            scannedFiles={results.scannedFiles}
            languagesDetected={results.languagesDetected}
            totalIssueCount={results.summary.total}
            filteredIssueCount={filteredIssues.length}
            showFix={showFix}
            fixCache={fixCache}
            validationResults={validationResults}
            validatingIssues={validatingIssues}
            hasValidApiKey={hasValidApiKey}
            onShowFix={handleShowFix}
            onValidate={handleValidate}
          />
        </div>
      </>
      )}
    </div>
    </TooltipProvider>
  )
}
