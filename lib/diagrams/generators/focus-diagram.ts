// Generator — Focus Mode (file neighborhood)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult } from '../types'
import { sanitizeId, escapeMermaidLabel, MERMAID_EDGE_BUDGET, MERMAID_SOURCE_BUDGET } from '../helpers'

export function generateFocusDiagram(analysis: FullAnalysis, targetPath: string, hops: 1 | 2 = 1): MermaidDiagramResult {
  const { graph } = analysis
  const nodePathMap = new Map<string, string>()

  let chart = 'flowchart LR\n'

  // Collect neighborhood
  const neighborhood = new Set<string>([targetPath])

  const directDependencies = new Set(graph.edges.get(targetPath) || [])
  const directImporters = new Set(graph.reverseEdges.get(targetPath) || [])
  const firstHop = new Set([...directDependencies, ...directImporters])
  for (const path of firstHop) neighborhood.add(path)
  const secondHopDependencies = new Set<string>()
  const secondHopImporters = new Set<string>()
  if (hops === 2) {
    // Preserve the original undirected neighborhood semantics: every direct
    // neighbor contributes both its dependencies and its importers. Styling
    // still uses the explicit direct sets above.
    for (const path of firstHop) {
      for (const dep of graph.edges.get(path) || []) secondHopDependencies.add(dep)
      for (const importer of graph.reverseEdges.get(path) || []) secondHopImporters.add(importer)
    }
    for (const path of [...secondHopDependencies, ...secondHopImporters]) neighborhood.add(path)
  }

  if (neighborhood.size <= 1) {
    chart += `  target["${escapeMermaidLabel(targetPath.split('/').pop() || targetPath)}"]:::targetStyle\n`
    chart += '  note["No connections found"]\n'
    chart += '  target --- note\n'
    chart += '\n  classDef targetStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
    nodePathMap.set('target', targetPath)
    return { type: 'focus', title: `Focus: ${targetPath.split('/').pop()}`, chart, stats: { totalNodes: 1, totalEdges: 0, omittedNodes: 0, omittedEdges: 0 }, nodePathMap }
  }

  const allEdges: { from: string; to: string }[] = []
  for (const path of [...neighborhood].sort()) {
    const deps = graph.edges.get(path)
    if (deps) {
      for (const dep of [...deps].sort()) if (neighborhood.has(dep)) allEdges.push({ from: path, to: dep })
    }
  }
  const focalEdges = allEdges.filter(({ from, to }) =>
    (from === targetPath && firstHop.has(to)) || (to === targetPath && firstHop.has(from)))
  const contextEdges = allEdges.filter(({ from, to }) =>
    !((from === targetPath && firstHop.has(to)) || (to === targetPath && firstHop.has(from))))
  const prioritizedEdges = [...focalEdges, ...contextEdges]

  const interleave = (left: string[], right: string[]): string[] => {
    const result: string[] = []
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      if (left[index]) result.push(left[index])
      if (right[index]) result.push(right[index])
    }
    return result
  }
  const orderedPaths = [...new Set([
    targetPath,
    ...interleave([...directDependencies].sort(), [...directImporters].sort()),
    ...interleave([...secondHopDependencies].sort(), [...secondHopImporters].sort()),
  ])]

  const render = (maxNodes: number) => {
    const selectedPaths = orderedPaths.slice(0, maxNodes)
    const selected = new Set(selectedPaths)
    const renderedMap = new Map<string, string>()
    let renderedChart = 'flowchart LR\n'

    for (const path of selectedPaths) {
      const id = sanitizeId(path)
      const rawName = path.split('/').pop() || path
      const name = escapeMermaidLabel(rawName.length > 120 ? `${rawName.slice(0, 117)}...` : rawName)
      const style = path === targetPath
        ? 'targetStyle'
        : directDependencies.has(path) || secondHopDependencies.has(path)
          ? 'depStyle'
          : 'importerStyle'
      renderedChart += `  ${id}["${name}"]:::${style}\n`
      renderedMap.set(id, path)
    }

    renderedChart += '\n'
    const eligibleEdges = prioritizedEdges.filter(({ from, to }) => selected.has(from) && selected.has(to))
    const renderedEdges = eligibleEdges.slice(0, MERMAID_EDGE_BUDGET)
    for (const { from, to } of renderedEdges) renderedChart += `  ${sanitizeId(from)} --> ${sanitizeId(to)}\n`
    const omittedNodes = neighborhood.size - selected.size
    const omittedEdges = allEdges.length - renderedEdges.length
    if (omittedNodes > 0 || omittedEdges > 0) renderedChart += `  %% ${omittedNodes} nodes and ${omittedEdges} edges omitted\n`

    renderedChart += '\n  classDef targetStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
    renderedChart += '  classDef importerStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
    renderedChart += '  classDef depStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'
    return { chart: renderedChart, nodePathMap: renderedMap, nodeCount: selected.size, edgeCount: renderedEdges.length, omittedNodes, omittedEdges }
  }

  let low = 1
  let high = orderedPaths.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (render(mid).chart.length <= MERMAID_SOURCE_BUDGET) low = mid
    else high = mid - 1
  }
  const rendered = render(low)

  return {
    type: 'focus',
    title: `Focus: ${targetPath.split('/').pop()} (${rendered.nodeCount}${rendered.omittedNodes > 0 ? ` of ${neighborhood.size}` : ''} files, ${hops}-hop)`,
    chart: rendered.chart,
    stats: { totalNodes: rendered.nodeCount, totalEdges: rendered.edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges },
    nodePathMap: rendered.nodePathMap,
  }
}
