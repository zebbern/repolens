"use client"

import { useState, useCallback } from 'react'
import type { ComplianceCategory } from '@/lib/code/issue-scanner'
import { cn } from '@/lib/utils'
import {
  Shield,
  ShieldAlert,
  AlertTriangle,
  Circle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

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
}

export function CoverageGrid({ title, categories }: CoverageGridProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
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

          return (
            <div key={id}>
              <button
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
                      <span className="font-mono truncate max-w-[200px]" title={cat.ruleIds.join(', ')}>
                        Rules: {cat.ruleIds.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
