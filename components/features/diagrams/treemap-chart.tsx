"use client"

import { useState, useMemo } from 'react'
import type { TreemapNode } from '@/lib/diagrams/diagram-data'
import { layoutTreemap } from './treemap-layout'
import { getLangColor } from './diagram-constants'

interface TreemapChartProps {
  data: TreemapNode[]
  width: number
  height: number
  onNodeClick?: (path: string) => void
}

export function TreemapChart({ data, width, height, onNodeClick }: TreemapChartProps) {
  const rects = useMemo(() => layoutTreemap(data, 0, 0, width, height), [data, width, height])
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <svg width={width} height={height} className="select-none">
      {rects.map(({ node, x, y, w, h }) => {
        if (w < 2 || h < 2) return null
        const color = getLangColor(node.language)
        const isHovered = hovered === node.path
        // Show filename if rect is wide enough, show lines if tall enough
        const canFitName = w > 40 && h > 16
        const canFitLines = w > 40 && h > 30
        const maxChars = Math.max(3, Math.floor((w - 8) / 6.5))
        const displayName = node.name.length > maxChars ? node.name.slice(0, maxChars - 1) + '\u2026' : node.name
        return (
          <g key={node.path} className="cursor-pointer" onClick={() => onNodeClick?.(node.path)} onMouseEnter={() => setHovered(node.path)} onMouseLeave={() => setHovered(null)}>
            <rect
              x={x + 0.5} y={y + 0.5}
              width={Math.max(0, w - 1)} height={Math.max(0, h - 1)}
              fill={color}
              opacity={isHovered ? 1 : 0.8}
              rx={2}
              stroke={isHovered ? '#fff' : 'rgba(0,0,0,0.4)'}
              strokeWidth={isHovered ? 1.5 : 0.5}
            />
            {canFitName && (
              <text x={x + 4} y={y + 13} fill="#fff" fontSize={10} fontWeight={500} style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }} className="pointer-events-none">
                {displayName}
              </text>
            )}
            {canFitLines && (
              <text x={x + 4} y={y + 25} fill="rgba(255,255,255,0.65)" fontSize={9} className="pointer-events-none">
                {node.lines.toLocaleString()} lines
              </text>
            )}
            <title>{`${node.path}\n${node.lines.toLocaleString()} lines${node.language ? `\n${node.language}` : ''}`}</title>
          </g>
        )
      })}
    </svg>
  )
}
