"use client"

import { useId, useMemo, useState, useEffect } from 'react'
import type { DownloadPoint } from '@/lib/deps/types'
import { loadRecharts, type RechartsModule } from '@/lib/lazy-recharts'

const numberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact' })

interface DownloadSparklineProps {
  data: DownloadPoint[]
  packageName?: string
  width?: number
  height?: number
  className?: string
}

interface SparklinePayload {
  day: string
  downloads: number
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: SparklinePayload }>
}) {
  if (!active || !payload?.[0]) return null
  const { day, downloads } = payload[0].payload
  return (
    <div className="rounded border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-xs">
      <span className="font-medium">{numberFormatter.format(downloads)}</span>
      <span className="ml-1.5 text-muted-foreground">{day}</span>
    </div>
  )
}

export function DownloadSparkline({
  data,
  packageName,
  width = 120,
  height = 40,
  className,
}: DownloadSparklineProps) {
  const id = useId()
  const gradientId = `sparkFill-${id}`
  const [rc, setRc] = useState<RechartsModule | null>(null)

  useEffect(() => {
    loadRecharts().then(setRc)
  }, [])

  const chartData = useMemo(
    () => data.map(d => ({ day: d.day, downloads: d.downloads })),
    [data],
  )

  if (chartData.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  if (!rc) {
    return (
      <div className={className} style={{ width, height }}>
        <div className="h-full w-full animate-pulse rounded bg-muted" />
      </div>
    )
  }

  const { AreaChart, Area, ResponsiveContainer, Tooltip: RechartsTooltip } = rc

  return (
    <div
      className={className}
      style={{ width, height }}
      role="img"
      aria-label={packageName ? `Download trend for ${packageName}` : 'Download trend'}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <RechartsTooltip
            content={<CustomTooltip />}
            cursor={false}
          />
          <Area
            type="monotone"
            dataKey="downloads"
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
