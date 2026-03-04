"use client"

import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { DiagramStats } from '@/lib/diagrams/diagram-data'

interface StatsBarProps {
  stats: DiagramStats
  topology?: {
    clusters: number
    maxDepth: number
    orphans: number
    connectors: number
  }
}

export function StatsBar({ stats, topology }: StatsBarProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-foreground/[0.06] text-xs text-text-muted bg-card">
      <span><span className="text-text-secondary font-medium">{stats.totalNodes}</span> nodes</span>
      {stats.totalEdges > 0 && <span><span className="text-text-secondary font-medium">{stats.totalEdges}</span> edges</span>}
      {stats.avgDepsPerFile !== undefined && <span><span className="text-text-secondary font-medium">{stats.avgDepsPerFile}</span> avg deps/file</span>}
      {stats.circularDeps && stats.circularDeps.length > 0 && (
        <span className="flex items-center gap-1 text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          <span className="font-medium">{stats.circularDeps.length}</span> circular
        </span>
      )}
      {topology && (
        <>
          <span className="border-l border-foreground/[0.06] pl-4"><span className="text-text-secondary font-medium">{topology.clusters}</span> clusters</span>
          <span>depth <span className="text-text-secondary font-medium">{topology.maxDepth}</span></span>
          {topology.orphans > 0 && <span className="text-gray-500">{topology.orphans} orphans</span>}
          {topology.connectors > 0 && <span className="text-purple-400">{topology.connectors} connectors</span>}
        </>
      )}
      {stats.mostImported && (
        <span className="flex items-center gap-1 ml-auto">
          <ArrowRight className="h-3 w-3" />
          Most imported: <span className="text-text-secondary font-medium">{stats.mostImported.path.split('/').pop()}</span> ({stats.mostImported.count})
        </span>
      )}
    </div>
  )
}
