// Diagram Helpers — shared utilities for diagram generators

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { DiagramStats, AvailableDiagram } from './types'

export function sanitizeId(path: string): string {
  // Mermaid node ids have a deliberately small safe alphabet. Encode every
  // character outside that alphabet, including underscores, between `_`
  // delimiters. Because literal characters can never introduce a delimiter,
  // this representation is one-to-one rather than merely collision-resistant.
  // The fixed prefix also prevents reserved words such as `end` and `click`
  // from being emitted as bare ids.
  const encoded = Array.from(path, character => {
    if (/^[a-zA-Z0-9]$/.test(character)) return character
    return `_${character.codePointAt(0)!.toString(16)}_`
  }).join('')

  return `id_${encoded}`
}

export function escapeMermaidLabel(label: string): string {
  return label.replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const MERMAID_EDGE_BUDGET = 499
export const MERMAID_SOURCE_BUDGET = 45_000

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
    { id: 'treemap', label: 'Treemap', available: true },
    { id: 'topology', label: 'Architecture', available: analysis.files.size > 0 },
    { id: 'entrypoints', label: analysis.detectedFramework ? 'Routes' : 'Entry Points', available: true },
    { id: 'modules', label: hasComponents ? 'Components' : 'Modules', available: hasModules, reason: 'No module usage detected' },
  ]

  // Only show the Types diagram when the codebase actually has classes or interfaces
  if (hasTypes) {
    diagrams.splice(2, 0, { id: 'classes', label: 'Types', available: true })
  }

  return diagrams
}
