// Generator — Module Usage Tree (React components or reverse-dep tree for any lang)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult } from '../types'
import { sanitizeId, getTopDir, escapeMermaidLabel, MERMAID_EDGE_BUDGET, MERMAID_SOURCE_BUDGET } from '../helpers'

export function generateModuleUsageTree(analysis: FullAnalysis): MermaidDiagramResult {
  const { graph, topology, files } = analysis
  const nodePathMap = new Map<string, string>()
  const fileId = (path: string) => sanitizeId(`file:${path}`)
  const subgraphId = (name: string) => sanitizeId(`subgraph:${name}`)

  // Try JSX component tree first (React/Preact/Solid)
  const componentToFiles = new Map<string, string[]>()
  for (const [path, fileAnalysis] of files) {
    for (const exp of fileAnalysis.exports) {
      if (exp.kind === 'component' || (/^[A-Z]/.test(exp.name) && (exp.kind === 'function' || exp.kind === 'variable'))) {
        const paths = componentToFiles.get(exp.name) || []
        paths.push(path)
        componentToFiles.set(exp.name, paths)
      }
    }
  }

  const jsxEdges = new Map<string, Set<string>>()
  for (const [path, fileAnalysis] of files) {
    for (const jsxComp of fileAnalysis.jsxComponents) {
      const importedTarget = fileAnalysis.imports.find(imp => imp.resolvedPath && imp.specifiers.includes(jsxComp))?.resolvedPath
      const candidates = componentToFiles.get(jsxComp) || []
      const targetFile = importedTarget || (candidates.length === 1 ? candidates[0] : undefined)
      if (targetFile && targetFile !== path) {
        if (!jsxEdges.has(path)) jsxEdges.set(path, new Set())
        jsxEdges.get(path)!.add(targetFile)
      }
    }
  }

  const useJsx = jsxEdges.size > 0

  let chart = 'flowchart TD\n'

  if (useJsx) {
    // JSX component rendering tree
    const allRendered = new Set<string>()
    for (const targets of jsxEdges.values()) for (const t of targets) allRendered.add(t)
    const allRenderers = new Set(jsxEdges.keys())
    const roots = new Set<string>()
    for (const renderer of allRenderers) {
      if (!allRendered.has(renderer)) roots.add(renderer)
    }
    if (roots.size === 0 && allRenderers.size > 0) roots.add(allRenderers.values().next().value!)

    const participatingFiles = new Set<string>([...allRenderers, ...allRendered])
    if (participatingFiles.size === 0) {
      chart += '  empty["No component render tree detected"]\n'
      return { type: 'modules', title: 'Component Tree', chart, stats: { totalNodes: 0, totalEdges: 0 }, nodePathMap }
    }

    const allEdges = [...jsxEdges.entries()].flatMap(([from, targets]) => [...targets].map(to => ({ from, to })))
      .sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`))
    const incomingCounts = new Map<string, number>()
    for (const { to } of allEdges) incomingCounts.set(to, (incomingCounts.get(to) || 0) + 1)
    // Seed the order from complete edge pairs so a size-limited chart keeps
    // useful relationships (especially disjoint renderer/target pairs).
    const edgeOrderedPaths: string[] = []
    const edgeOrderedSet = new Set<string>()
    for (const { from, to } of allEdges) {
      for (const path of [to, from]) {
        if (!edgeOrderedSet.has(path)) {
          edgeOrderedSet.add(path)
          edgeOrderedPaths.push(path)
        }
      }
    }
    const rankedPaths = [...participatingFiles].sort((a, b) => {
      const score = (incomingCounts.get(b) || 0) - (incomingCounts.get(a) || 0)
      if (score !== 0) return score
      const rootBias = Number(roots.has(b)) - Number(roots.has(a))
      return rootBias !== 0 ? rootBias : a.localeCompare(b)
    })
    const orderedPaths = [...edgeOrderedPaths, ...rankedPaths.filter(path => !edgeOrderedSet.has(path))]

    const render = (maxNodes: number) => {
      const selectedPaths = orderedPaths.slice(0, maxNodes)
      const selected = new Set(selectedPaths)
      const byDir = new Map<string, string[]>()
      for (const path of selectedPaths) {
        const dir = getTopDir(path)
        if (!byDir.has(dir)) byDir.set(dir, [])
        byDir.get(dir)!.push(path)
      }
      let renderedChart = 'flowchart TD\n'
      const renderedMap = new Map<string, string>()
      for (const [dir, paths] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        renderedChart += `  subgraph ${subgraphId(`${dir}_comp`)}["${escapeMermaidLabel(dir)}/"]\n`
        for (const path of paths) {
          const id = fileId(path)
          const fa = files.get(path)
          const compNames = fa?.exports.filter(e => e.kind === 'component' || /^[A-Z]/.test(e.name)).map(e => e.name).slice(0, 3) || []
          const rawLabel = compNames.length > 0 ? compNames.join(', ') : path.split('/').pop() || path
          const label = rawLabel.length > 120 ? `${rawLabel.slice(0, 117)}...` : rawLabel
          renderedChart += `    ${id}["${escapeMermaidLabel(label)}"]\n`
          renderedMap.set(id, path)
        }
        renderedChart += '  end\n'
      }
      renderedChart += '\n'
      const eligibleEdges = allEdges.filter(({ from, to }) => selected.has(from) && selected.has(to))
      const renderedEdges = eligibleEdges.slice(0, MERMAID_EDGE_BUDGET)
      for (const { from, to } of renderedEdges) renderedChart += `  ${fileId(from)} --> ${fileId(to)}\n`
      const omittedEdges = allEdges.length - renderedEdges.length
      const omittedNodes = participatingFiles.size - selected.size
      if (omittedNodes > 0 || omittedEdges > 0) {
        renderedChart += `  %% ${omittedNodes} nodes and ${omittedEdges} edges omitted\n`
      }
      return { chart: renderedChart, nodePathMap: renderedMap, nodeCount: selected.size, edgeCount: renderedEdges.length, omittedNodes, omittedEdges }
    }

    // Binary search for the largest useful deterministic node set that fits
    // Mermaid's source-size limit.
    let low = 1
    let high = orderedPaths.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (render(mid).chart.length <= MERMAID_SOURCE_BUDGET) low = mid
      else high = mid - 1
    }
    const rendered = render(low)
    return {
      type: 'modules', title: `Component Tree (${rendered.nodeCount} components)`, chart: rendered.chart,
      stats: { totalNodes: rendered.nodeCount, totalEdges: rendered.edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges },
      nodePathMap: rendered.nodePathMap,
    }
  }

  // Non-JSX: show reverse-dependency tree for top hubs
  if (topology.hubs.length === 0) {
    chart += '  empty["No module dependency tree to show"]\n'
    return { type: 'modules', title: 'Module Usage', chart, stats: { totalNodes: 0, totalEdges: 0 }, nodePathMap }
  }

  // Show top hubs and their importers within the same source-size budget used
  // by component trees.
  const hubsToShow = topology.hubs.slice(0, 8)
  const allEdges = hubsToShow.flatMap(hub => {
    const importers = graph.reverseEdges.get(hub) || new Set<string>()
    return [...importers].map(importer => ({ from: importer, to: hub }))
  }).sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`))
  const hubSet = new Set(hubsToShow)
  const orderedPaths = [...new Set([
    ...hubsToShow,
    ...allEdges.map(edge => edge.from).sort(),
  ])]
  const render = (maxNodes: number) => {
    const selectedPaths = orderedPaths.slice(0, maxNodes)
    const selected = new Set(selectedPaths)
    const renderedMap = new Map<string, string>()
    let renderedChart = 'flowchart TD\n'
    for (const path of selectedPaths) {
      const id = sanitizeId(path)
      const rawName = path.split('/').pop() || path
      const name = escapeMermaidLabel(rawName.length > 120 ? `${rawName.slice(0, 117)}...` : rawName)
      renderedChart += `  ${id}["${name}"]${hubSet.has(path) ? ':::hubStyle' : ''}\n`
      renderedMap.set(id, path)
    }
    const eligibleEdges = allEdges.filter(({ from, to }) => selected.has(from) && selected.has(to))
    const renderedEdges = eligibleEdges.slice(0, MERMAID_EDGE_BUDGET)
    for (const { from, to } of renderedEdges) renderedChart += `  ${sanitizeId(from)} --> ${sanitizeId(to)}\n`
    const omittedNodes = orderedPaths.length - selected.size
    const omittedEdges = allEdges.length - renderedEdges.length
    if (omittedNodes > 0 || omittedEdges > 0) renderedChart += `  %% ${omittedNodes} nodes and ${omittedEdges} edges omitted\n`
    renderedChart += '\n  classDef hubStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
    return { chart: renderedChart, nodePathMap: renderedMap, nodeCount: selected.size, edgeCount: renderedEdges.length, omittedNodes, omittedEdges }
  }

  let low = hubsToShow.length
  let high = orderedPaths.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (render(mid).chart.length <= MERMAID_SOURCE_BUDGET) low = mid
    else high = mid - 1
  }
  const rendered = render(low)

  return {
    type: 'modules',
    title: `Module Usage (${hubsToShow.length} hubs)`,
    chart: rendered.chart,
    stats: { totalNodes: rendered.nodeCount, totalEdges: rendered.edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges },
    nodePathMap: rendered.nodePathMap,
  }
}
