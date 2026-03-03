// Generator — Focus Mode (file neighborhood)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult } from '../types'
import { sanitizeId } from '../helpers'

export function generateFocusDiagram(analysis: FullAnalysis, targetPath: string, hops: 1 | 2 = 1): MermaidDiagramResult {
  const { graph } = analysis
  const nodePathMap = new Map<string, string>()

  let chart = 'flowchart LR\n'

  // Collect neighborhood
  const neighborhood = new Set<string>([targetPath])

  function addHop(nodes: Set<string>) {
    const newNodes = new Set<string>()
    for (const n of nodes) {
      const deps = graph.edges.get(n)
      if (deps) for (const d of deps) newNodes.add(d)
      const importers = graph.reverseEdges.get(n)
      if (importers) for (const i of importers) newNodes.add(i)
    }
    for (const n of newNodes) nodes.add(n)
    return newNodes
  }

  const firstHop = addHop(neighborhood)
  if (hops === 2) addHop(neighborhood)

  if (neighborhood.size <= 1) {
    chart += `  target["${targetPath.split('/').pop() || targetPath}"]:::targetStyle\n`
    chart += '  note["No connections found"]\n'
    chart += '  target --- note\n'
    chart += '\n  classDef targetStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
    nodePathMap.set('target', targetPath)
    return { type: 'focus', title: `Focus: ${targetPath.split('/').pop()}`, chart, stats: { totalNodes: 1, totalEdges: 0 }, nodePathMap }
  }

  // Render nodes
  for (const path of neighborhood) {
    const id = sanitizeId(path)
    const name = path.split('/').pop() || path
    if (path === targetPath) {
      chart += `  ${id}["${name}"]:::targetStyle\n`
    } else if (graph.reverseEdges.get(targetPath)?.has(path) || (hops === 2 && firstHop.has(path))) {
      // Importers of target
      chart += `  ${id}["${name}"]:::importerStyle\n`
    } else {
      chart += `  ${id}["${name}"]:::depStyle\n`
    }
    nodePathMap.set(id, path)
  }

  chart += '\n'

  // Render edges within neighborhood
  let edgeCount = 0
  for (const path of neighborhood) {
    const deps = graph.edges.get(path)
    if (deps) {
      for (const dep of deps) {
        if (neighborhood.has(dep)) {
          chart += `  ${sanitizeId(path)} --> ${sanitizeId(dep)}\n`
          edgeCount++
        }
      }
    }
  }

  chart += '\n  classDef targetStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
  chart += '  classDef importerStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
  chart += '  classDef depStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'

  return {
    type: 'focus',
    title: `Focus: ${targetPath.split('/').pop()} (${neighborhood.size} files, ${hops}-hop)`,
    chart,
    stats: { totalNodes: neighborhood.size, totalEdges: edgeCount },
    nodePathMap,
  }
}
