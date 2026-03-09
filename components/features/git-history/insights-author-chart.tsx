"use client"

import { useMemo, useState, useEffect } from 'react'
import { loadRecharts, type RechartsModule } from '@/lib/lazy-recharts'
import type { AuthorHoursEstimate } from '@/lib/git-history'

interface InsightsAuthorChartProps {
  estimates: AuthorHoursEstimate[]
}

const MAX_AUTHORS = 15

interface TooltipEntry {
  payload: { author: string; hours: number; avatarUrl: string | null }
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipEntry[]
}) {
  if (!active || !payload?.[0]) return null
  const { author, hours } = payload[0].payload
  return (
    <div className="rounded border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xs">
      <span className="font-medium">{author}</span>
      <span className="ml-2 text-muted-foreground">~{hours.toFixed(1)}h</span>
    </div>
  )
}

export function InsightsAuthorChart({ estimates }: InsightsAuthorChartProps) {
  const [rc, setRc] = useState<RechartsModule | null>(null)

  useEffect(() => {
    loadRecharts().then(setRc)
  }, [])

  const { chartData, overflowCount } = useMemo(() => {
    const sorted = [...estimates].sort((a, b) => b.totalHours - a.totalHours)
    const limited = sorted.slice(0, MAX_AUTHORS)
    const overflow = sorted.length - MAX_AUTHORS

    const data = limited.map((e) => ({
      author: e.author,
      hours: Number(e.totalHours.toFixed(1)),
      avatarUrl: e.avatarUrl,
    }))

    return { chartData: data, overflowCount: overflow > 0 ? overflow : 0 }
  }, [estimates])

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-card py-12 text-sm text-muted-foreground">
        No data to show
      </div>
    )
  }

  if (!rc) {
    return <div className="h-[300px] w-full animate-pulse rounded-lg bg-muted" />
  }

  const {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip: RechartsTooltip,
    ResponsiveContainer,
  } = rc

  const barHeight = Math.max(chartData.length * 32, 200)

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">Hours by Author</h3>
      <ResponsiveContainer width="100%" height={barHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}h`}
          />
          <YAxis
            type="category"
            dataKey="author"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            width={100}
          />
          <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
          <Bar
            dataKey="hours"
            fill="hsl(var(--chart-1))"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      {overflowCount > 0 && (
        <p className="mt-2 text-xs text-muted-foreground text-center">
          and {overflowCount} more contributor{overflowCount === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}
