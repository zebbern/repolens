"use client"

import { useId, useMemo, useState, useEffect } from 'react'
import { loadRecharts, type RechartsModule } from '@/lib/lazy-recharts'
import { computeHoursOverTime } from '@/lib/git-history'
import type { AuthorHoursEstimate } from '@/lib/git-history'

interface InsightsHoursChartProps {
  estimates: AuthorHoursEstimate[]
}

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

interface TooltipEntry {
  payload: Record<string, unknown>
  name: string
  value: number
  color: string
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xs">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">~{entry.value.toFixed(1)}h</span>
        </div>
      ))}
    </div>
  )
}

export function InsightsHoursChart({ estimates }: InsightsHoursChartProps) {
  const id = useId()
  const [rc, setRc] = useState<RechartsModule | null>(null)

  useEffect(() => {
    loadRecharts().then(setRc)
  }, [])

  const allSessions = useMemo(
    () => estimates.flatMap((e) => e.sessions),
    [estimates],
  )

  const { chartData, authors } = useMemo(() => {
    const raw = computeHoursOverTime(allSessions, 'week')
    const authorSet = new Set<string>()
    const dateMap = new Map<string, Record<string, number>>()

    for (const point of raw) {
      authorSet.add(point.author)
      const row = dateMap.get(point.date) ?? {}
      row[point.author] = (row[point.author] ?? 0) + point.hours
      dateMap.set(point.date, row)
    }

    const sortedDates = Array.from(dateMap.keys()).sort()
    const authorsList = Array.from(authorSet)

    const data = sortedDates.map((date) => {
      const row: Record<string, string | number> = { date }
      for (const author of authorsList) {
        row[author] = Number((dateMap.get(date)?.[author] ?? 0).toFixed(2))
      }
      return row
    })

    return { chartData: data, authors: authorsList }
  }, [allSessions])

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-card py-12 text-sm text-muted-foreground">
        No data to show
      </div>
    )
  }

  if (!rc) {
    return (
      <div className="h-[300px] w-full animate-pulse rounded-lg bg-muted" />
    )
  }

  const {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip: RechartsTooltip,
    ResponsiveContainer,
  } = rc

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">Hours Over Time</h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <defs>
            {authors.map((author, i) => (
              <linearGradient
                key={author}
                id={`gradient-${id}-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                  stopOpacity={0.05}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}h`}
          />
          <RechartsTooltip content={<CustomTooltip />} />
          {authors.map((author, i) => (
            <Area
              key={author}
              type="monotone"
              dataKey={author}
              stackId="1"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={1.5}
              fill={`url(#gradient-${id}-${i})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
