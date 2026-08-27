"use client"

import { useState, useCallback } from 'react'
import type { CodeIssue, ComplianceCategory } from '@/lib/code/issue-scanner'
import { cn } from '@/lib/utils'
import {
  Shield,
  ShieldAlert,
  AlertTriangle,
  Circle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import { SEVERITY_CONFIG } from './constants'

type ComplianceStatus = 'pass' | 'warn' | 'fail' | 'no-coverage'

const STATUS_CONFIG: Record<ComplianceStatus, {
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon: typeof Shield
}> = {
  pass: {
    label: 'Pass',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    icon: Shield,
  },
  warn: {
    label: 'Warning',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    icon: AlertTriangle,
  },
  fail: {
    label: 'Fail',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    icon: ShieldAlert,
  },
  'no-coverage': {
    label: 'No Coverage',
    color: 'text-text-muted',
    bgColor: 'bg-foreground/4',
    borderColor: 'border-foreground/6',
    icon: Circle,
  },
}

interface CoverageGridProps {
  title: string
  categories: Record<string, ComplianceCategory>
  onNavigateToFile?: (path: string) => void
}

function FindingDetails({ issue, onNavigateToFile }: { issue: CodeIssue; onNavigateToFile?: (path: string) => void }) {
  return (
    <div className="px-3 pb-3 ml-5 flex flex-col gap-2">
      <p className="text-[11px] text-text-muted leading-relaxed">{issue.description}</p>
      {issue.snippet && (
        <div className="rounded bg-foreground/5 border border-foreground/4 px-2.5 py-1.5 overflow-x-auto">
          <code className="text-[10px] font-mono text-text-secondary whitespace-pre">{issue.snippet}</code>
        </div>
      )}
      {issue.suggestion && (
        <p className="text-[10px] leading-relaxed text-emerald-700 dark:text-emerald-400/90">
          <span className="font-medium">Fix: </span>{issue.suggestion}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
        <span className="font-mono">{issue.file}:{issue.line}</span>
        {issue.cwe && (
          <a
            href={`https://cwe.mitre.org/data/definitions/${issue.cwe.replace('CWE-', '')}.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-blue-700 hover:underline dark:text-blue-400"
          >
            {issue.cwe}
          </a>
        )}
        {issue.learnMoreUrl && (
          <a href={issue.learnMoreUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-blue-700 hover:underline dark:text-blue-400">
            Learn more <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
          </a>
        )}
        {onNavigateToFile && (
          <button
            type="button"
            onClick={() => onNavigateToFile(issue.file)}
            className="text-text-secondary hover:text-text-primary hover:underline"
          >
            Open in Code
          </button>
        )}
      </div>
    </div>
  )
}

function FindingRow({ issue, expanded, onToggle, onNavigateToFile }: {
  issue: CodeIssue
  expanded: boolean
  onToggle: () => void
  onNavigateToFile?: (path: string) => void
}) {
  const severity = SEVERITY_CONFIG[issue.severity]
  const SeverityIcon = severity.icon

  return (
    <div className={cn('rounded border', severity.borderColor, severity.bgColor)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-foreground/5 transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3 text-text-muted shrink-0" /> : <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />}
        <SeverityIcon className={cn('h-3 w-3 shrink-0', severity.color)} aria-hidden="true" />
        <span className="text-[11px] text-text-primary truncate flex-1">{issue.title}</span>
        <span className="max-w-[45%] min-w-0 shrink truncate font-mono text-[10px] text-text-muted" title={`${issue.file}:${issue.line}`}>
          {issue.file}:{issue.line}
        </span>
      </button>
      {expanded && <FindingDetails issue={issue} onNavigateToFile={onNavigateToFile} />}
    </div>
  )
}

export function CoverageGrid({ title, categories, onNavigateToFile }: CoverageGridProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleFinding = useCallback((id: string) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const entries = Object.entries(categories)

  const statusCounts = entries.reduce(
    (acc, [, cat]) => {
      acc[cat.status] = (acc[cat.status] || 0) + 1
      return acc
    },
    {} as Record<ComplianceStatus, number>,
  )

  return (
    <div className="rounded-md border border-foreground/6">
      {/* Grid Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/6">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <div className="flex items-center gap-1.5">
          {(['pass', 'warn', 'fail', 'no-coverage'] as const).map((s) => {
            const count = statusCounts[s] || 0
            if (count === 0) return null
            const cfg = STATUS_CONFIG[s]
            return (
              <span
                key={s}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full border tabular-nums',
                  cfg.bgColor, cfg.borderColor, cfg.color,
                )}
              >
                {count}
              </span>
            )
          })}
        </div>
      </div>

      {/* Grid Items */}
      <div className="divide-y divide-foreground/4">
        {entries.map(([id, cat]) => {
          const cfg = STATUS_CONFIG[cat.status]
          const StatusIcon = cfg.icon
          const isExpanded = expanded.has(id)
          const issues = cat.issues ?? []

          return (
            <div key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-expanded={isExpanded}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-foreground/2 transition-colors text-left"
              >
                {isExpanded
                  ? <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
                  : <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />}
                <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', cfg.color)} />
                <span className="text-[11px] font-mono text-text-muted shrink-0 w-12">{id}</span>
                <span className="text-xs text-text-primary flex-1 truncate">{cat.name}</span>

                {/* Badges */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {cat.findingCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-red-500/10 border-red-500/20 text-red-400 tabular-nums">
                      {cat.findingCount} {cat.findingCount === 1 ? 'issue' : 'issues'}
                    </span>
                  )}
                  <span
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full border tabular-nums',
                      cfg.bgColor, cfg.borderColor, cfg.color,
                    )}
                  >
                    {cfg.label}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-3 pl-12">
                  <p className="text-[11px] text-text-muted leading-relaxed mb-2">{cat.description}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
                    <span>{cat.ruleCount} {cat.ruleCount === 1 ? 'rule' : 'rules'} mapped</span>
                    <span>{cat.findingCount} {cat.findingCount === 1 ? 'finding' : 'findings'}</span>
                    {cat.ruleIds.length > 0 && (
                      <span className="min-w-0 break-all font-mono">
                        Rules: {cat.ruleIds.join(', ')}
                      </span>
                    )}
                  </div>
                  {issues.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5" aria-label={`${issues.length} mapped findings`}>
                      <p className="text-[10px] font-medium text-text-secondary">Mapped findings</p>
                      {issues.map(issue => {
                        const findingKey = `${id}:${issue.id}`
                        return (
                          <FindingRow
                            key={findingKey}
                            issue={issue}
                            expanded={expandedFindings.has(findingKey)}
                            onToggle={() => toggleFinding(findingKey)}
                            onNavigateToFile={onNavigateToFile}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
