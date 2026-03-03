// Generator — Import Graph

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult, DiagramStats } from '../types'
import { sanitizeId, getTopDir, computeCommonStats } from '../helpers'

export function generateImportGraph(analysis: FullAnalysis): MermaidDiagramResult {
  const { graph, files } = analysis
  const nodePathMap = new Map<string, string>()
  const commonStats = computeCommonStats(analysis)

  const fileCount = files.size
  const collapsed = fileCount > 50

  let chart = 'flowchart LR\n'

  if (collapsed) {
    const dirEdges = new Map<string, Map<string, number>>()
    const dirFiles = new Map<string, number>()
    for (const [path] of files) {
      const dir = getTopDir(path)
      dirFiles.set(dir, (dirFiles.get(dir) || 0) + 1)
    }
    for (const [from, deps] of graph.edges) {
      const fromDir = getTopDir(from)
      for (const to of deps) {
        const toDir = getTopDir(to)
        if (fromDir === toDir) continue
        if (!dirEdges.has(fromDir)) dirEdges.set(fromDir, new Map())
        const existing = dirEdges.get(fromDir)!.get(toDir) || 0
        dirEdges.get(fromDir)!.set(toDir, existing + 1)
      }
    }
    for (const [dir, count] of dirFiles) {
      const id = sanitizeId(dir)
      chart += `  ${id}["${dir}/ (${count} files)"]\n`
      nodePathMap.set(id, dir)
    }
    chart += '\n'
    for (const [fromDir, targets] of dirEdges) {
      for (const [toDir, count] of targets) {
        chart += `  ${sanitizeId(fromDir)} -->|"${count}"| ${sanitizeId(toDir)}\n`
      }
    }
    return {
      type: 'imports',
      title: `Import Graph (${dirFiles.size} dirs, collapsed from ${fileCount} files)`,
      chart,
      stats: { totalNodes: dirFiles.size, ...commonStats } as DiagramStats,
      nodePathMap,
    }
  }

  // File-level with subgraphs by directory
  const byDir = new Map<string, string[]>()
  for (const [path] of files) {
    const dir = getTopDir(path)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir)!.push(path)
  }
  for (const [dir, paths] of byDir) {
    chart += `  subgraph ${sanitizeId(dir)}["${dir}/"]\n`
    for (const path of paths) {
      const id = sanitizeId(path)
      chart += `    ${id}["${path.split('/').pop() || path}"]\n`
      nodePathMap.set(id, path)
    }
    chart += '  end\n'
  }
  chart += '\n'
  const circularSet = new Set(graph.circular.map(([a, b]) => `${a}|${b}`))
  for (const [from, deps] of graph.edges) {
    for (const to of deps) {
      const isCircular = circularSet.has(`${from}|${to}`) || circularSet.has(`${to}|${from}`)
      if (isCircular) chart += `  ${sanitizeId(from)} -. "circular" .-> ${sanitizeId(to)}\n`
      else chart += `  ${sanitizeId(from)} --> ${sanitizeId(to)}\n`
    }
  }

  return {
    type: 'imports',
    title: `Import Graph (${fileCount} files)`,
    chart,
    stats: { totalNodes: fileCount, ...commonStats } as DiagramStats,
    nodePathMap,
  }
}
