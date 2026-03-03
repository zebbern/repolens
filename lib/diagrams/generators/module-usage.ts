// Generator — Module Usage Tree (React components or reverse-dep tree for any lang)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult } from '../types'
import { sanitizeId, getTopDir } from '../helpers'

export function generateModuleUsageTree(analysis: FullAnalysis): MermaidDiagramResult {
  const { graph, topology, files } = analysis
  const nodePathMap = new Map<string, string>()

  // Try JSX component tree first (React/Preact/Solid)
  const componentToFile = new Map<string, string>()
  for (const [path, fileAnalysis] of files) {
    for (const exp of fileAnalysis.exports) {
      if (exp.kind === 'component' || (/^[A-Z]/.test(exp.name) && (exp.kind === 'function' || exp.kind === 'variable'))) {
        componentToFile.set(exp.name, path)
      }
    }
  }

  const jsxEdges = new Map<string, Set<string>>()
  for (const [path, fileAnalysis] of files) {
    for (const jsxComp of fileAnalysis.jsxComponents) {
      const targetFile = componentToFile.get(jsxComp)
      if (targetFile && targetFile !== path) {
        if (!jsxEdges.has(path)) jsxEdges.set(path, new Set())
        jsxEdges.get(path)!.add(targetFile)
      }
    }
  }

  const useJsx = jsxEdges.size > 0

  let chart = 'flowchart TD\n'
  let nodeCount = 0

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

    const byDir = new Map<string, string[]>()
    for (const path of participatingFiles) {
      const dir = getTopDir(path)
      if (!byDir.has(dir)) byDir.set(dir, [])
      byDir.get(dir)!.push(path)
    }

    for (const [dir, paths] of byDir) {
      chart += `  subgraph ${sanitizeId(dir + '_comp')}["${dir}/"]\n`
      for (const path of paths) {
        const id = sanitizeId(path)
        const fa = files.get(path)
        const compNames = fa?.exports.filter(e => e.kind === 'component' || /^[A-Z]/.test(e.name)).map(e => e.name).slice(0, 3) || []
        const label = compNames.length > 0 ? compNames.join(', ') : path.split('/').pop() || path
        chart += `    ${id}["${label}"]\n`
        nodePathMap.set(id, path)
        nodeCount++
      }
      chart += '  end\n'
    }

    chart += '\n'
    let edgeCount = 0
    for (const [from, targets] of jsxEdges) {
      for (const to of targets) {
        chart += `  ${sanitizeId(from)} --> ${sanitizeId(to)}\n`
        edgeCount++
      }
    }

    return { type: 'modules', title: `Component Tree (${nodeCount} components)`, chart, stats: { totalNodes: nodeCount, totalEdges: edgeCount }, nodePathMap }
  }

  // Non-JSX: show reverse-dependency tree for top hubs
  if (topology.hubs.length === 0) {
    chart += '  empty["No module dependency tree to show"]\n'
    return { type: 'modules', title: 'Module Usage', chart, stats: { totalNodes: 0, totalEdges: 0 }, nodePathMap }
  }

  // Show top hubs and their importers
  const hubsToShow = topology.hubs.slice(0, 8)
  for (const hub of hubsToShow) {
    const hubId = sanitizeId(hub)
    const hubName = hub.split('/').pop() || hub
    chart += `  ${hubId}["${hubName}"]:::hubStyle\n`
    nodePathMap.set(hubId, hub)
    nodeCount++

    const importers = graph.reverseEdges.get(hub)
    if (importers) {
      for (const importer of importers) {
        const impId = sanitizeId(importer)
        if (!nodePathMap.has(impId)) {
          chart += `  ${impId}["${importer.split('/').pop() || importer}"]\n`
          nodePathMap.set(impId, importer)
          nodeCount++
        }
        chart += `  ${impId} --> ${hubId}\n`
      }
    }
  }

  chart += '\n  classDef hubStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'

  return {
    type: 'modules',
    title: `Module Usage (${hubsToShow.length} hubs)`,
    chart,
    stats: { totalNodes: nodeCount, totalEdges: 0 },
    nodePathMap,
  }
}
