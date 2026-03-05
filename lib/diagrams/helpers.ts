// Diagram Helpers — shared utilities for diagram generators

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { DiagramStats, AvailableDiagram } from './types'

export function sanitizeId(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

export function shortenPath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 2) return path
  return `${parts[0]}/.../${parts[parts.length - 1]}`
}

export function getTopDir(path: string): string {
  return path.split('/')[0] || path
}

export function computeCommonStats(analysis: FullAnalysis): Partial<DiagramStats> {
  const { graph } = analysis
  let mostImported: { path: string; count: number } | undefined
  let mostDependent: { path: string; count: number } | undefined
  let totalInternalEdges = 0

  for (const [path, deps] of graph.edges) {
    const count = deps.size
    totalInternalEdges += count
    if (!mostDependent || count > mostDependent.count) mostDependent = { path, count }
  }
  for (const [path, importers] of graph.reverseEdges) {
    const count = importers.size
    if (!mostImported || count > mostImported.count) mostImported = { path, count }
  }

  const fileCount = analysis.files.size
  return {
    totalEdges: totalInternalEdges,
    circularDeps: graph.circular.length > 0 ? graph.circular : undefined,
    mostImported,
    mostDependent,
    avgDepsPerFile: fileCount > 0 ? Math.round((totalInternalEdges / fileCount) * 10) / 10 : 0,
  }
}

export function getAvailableDiagrams(analysis: FullAnalysis): AvailableDiagram[] {
  const hasTypes = Array.from(analysis.files.values()).some(f => f.types.length > 0 || f.classes.length > 0)
  const hasComponents = Array.from(analysis.files.values()).some(f => f.jsxComponents.length > 0)
  // Modules tab: show if components exist (JSX) OR if hubs exist (reverse dep tree for any language)
  const hasModules = hasComponents || analysis.topology.hubs.length > 0

  const diagrams: AvailableDiagram[] = [
    { id: 'topology', label: 'Architecture', available: analysis.files.size > 0 },
    { id: 'entrypoints', label: analysis.detectedFramework ? 'Routes' : 'Entry Points', available: true },
    { id: 'modules', label: hasComponents ? 'Components' : 'Modules', available: hasModules, reason: 'No module usage detected' },
    { id: 'treemap', label: 'Treemap', available: true },
    { id: 'summary', label: 'Summary', available: analysis.files.size > 0 },
  ]

  // Only show the Types diagram when the codebase actually has classes or interfaces
  if (hasTypes) {
    diagrams.splice(1, 0, { id: 'classes', label: 'Types', available: true })
  }

  return diagrams
}
