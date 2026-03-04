"use client"

import type { ComplianceReport } from '@/lib/code/issue-scanner'
import { cn } from '@/lib/utils'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Tooltip as RechartsTooltip,
} from 'recharts'

interface CoverageSummaryChartProps {
  report: ComplianceReport
}

function getCoverageColor(percent: number): string {
  if (percent >= 80) return '#34d399'
  if (percent >= 50) return '#fbbf24'
  return '#f87171'
}

function getCoverageClass(percent: number): string {
  if (percent >= 80) return 'bg-emerald-500/10 border-emerald-500/20'
  if (percent >= 50) return 'bg-amber-500/10 border-amber-500/20'
  return 'bg-red-500/10 border-red-500/20'
}

function getCoverageTextClass(percent: number): string {
  if (percent >= 80) return 'text-emerald-400'
  if (percent >= 50) return 'text-amber-400'
  return 'text-red-400'
}

export function CoverageSummaryChart({ report }: CoverageSummaryChartProps) {
  const data = [
    {
      name: 'OWASP Top 10',
      coverage: report.overallOwaspPercent,
      fill: getCoverageColor(report.overallOwaspPercent),
    },
    {
      name: 'CWE Top 25',
      coverage: report.overallCwePercent,
      fill: getCoverageColor(report.overallCwePercent),
    },
  ]

  return (
    <div className="rounded-md border border-foreground/[0.06] p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Coverage Overview</h3>
      <div className="flex items-center gap-6">
        {/* Bar chart */}
        <div className="flex-1 h-[80px]" role="img" aria-label="Code coverage chart showing OWASP Top 10 at ${report.overallOwaspPercent}% and CWE Top 25 at ${report.overallCwePercent}%">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="name"
                width={90}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                axisLine={false}
                tickLine={false}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                }}
                formatter={(value: number) => [`${value}%`, 'Coverage']}
              />
              <Bar dataKey="coverage" radius={[0, 4, 4, 0]} barSize={16}>
                {data.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Percentage badges */}
        <div className="flex flex-col gap-2">
          {data.map((d) => (
            <div
              key={d.name}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md border',
                getCoverageClass(d.coverage),
              )}
            >
              <span className={cn('text-base font-bold tabular-nums', getCoverageTextClass(d.coverage))}>
                {d.coverage}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
