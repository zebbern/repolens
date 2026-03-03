// Generator — Topology Architecture (graph-role-based, not folder-name-based)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult, DiagramStats } from '../types'
import { sanitizeId, getTopDir, computeCommonStats } from '../helpers'

export function generateTopologyDiagram(analysis: FullAnalysis): MermaidDiagramResult {
  const { graph, topology, files } = analysis
  const nodePathMap = new Map<string, string>()
  const commonStats = computeCommonStats(analysis)

  // Classify every file by its topology role
  const roleMap = new Map<string, string>()
  for (const p of topology.entryPoints) roleMap.set(p, 'entry')
  for (const p of topology.hubs) { if (!roleMap.has(p)) roleMap.set(p, 'hub') }
  for (const p of topology.connectors) { if (!roleMap.has(p)) roleMap.set(p, 'connector') }
  for (const p of topology.leafNodes) { if (!roleMap.has(p)) roleMap.set(p, 'leaf') }
  for (const p of topology.orphans) roleMap.set(p, 'orphan')
  for (const p of files.keys()) { if (!roleMap.has(p)) roleMap.set(p, 'regular') }

  // Group by cluster for subgraphs
  const nodeCluster = new Map<string, number>()
  topology.clusters.forEach((cluster, idx) => {
    for (const p of cluster) nodeCluster.set(p, idx)
  })

  let chart = 'flowchart TD\n'

  // If very large (>80 files), aggregate by directory + role
  if (files.size > 80) {
    // Directory-level with role-based coloring
    const dirInfo = new Map<string, { count: number; roles: Set<string> }>()
    for (const [path] of files) {
      const dir = getTopDir(path)
      if (!dirInfo.has(dir)) dirInfo.set(dir, { count: 0, roles: new Set() })
      const info = dirInfo.get(dir)!
      info.count++
      info.roles.add(roleMap.get(path) || 'regular')
    }

    // Determine the dominant role for each directory
    const dirRole = new Map<string, string>()
    for (const [dir, info] of dirInfo) {
      // Priority: entry > hub > connector > regular > leaf > orphan
      const priority = ['entry', 'hub', 'connector', 'regular', 'leaf', 'orphan']
      let best = 'regular'
      for (const r of priority) {
        if (info.roles.has(r)) { best = r; break }
      }
      dirRole.set(dir, best)
    }

    for (const [dir, info] of dirInfo) {
      const id = sanitizeId(dir)
      const role = dirRole.get(dir)!
      const styleClass = `:::${role}Style`
      chart += `  ${id}["${dir}/ (${info.count} files)"]${styleClass}\n`
      nodePathMap.set(id, dir)
    }

    chart += '\n'

    // Directory-level edges
    const dirEdges = new Map<string, Map<string, number>>()
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

    for (const [fromDir, targets] of dirEdges) {
      for (const [toDir, count] of targets) {
        chart += `  ${sanitizeId(fromDir)} -->|"${count}"| ${sanitizeId(toDir)}\n`
      }
    }

    chart += '\n'
    chart += '  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
    chart += '  classDef hubStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
    chart += '  classDef connectorStyle fill:#a855f7,stroke:#c084fc,color:#fff\n'
    chart += '  classDef leafStyle fill:#6b7280,stroke:#9ca3af,color:#fff\n'
    chart += '  classDef orphanStyle fill:#374151,stroke:#4b5563,color:#9ca3af\n'
    chart += '  classDef regularStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'

    return {
      type: 'topology',
      title: `Architecture (${dirInfo.size} directories, ${files.size} files)`,
      chart,
      stats: { totalNodes: dirInfo.size, ...commonStats } as DiagramStats,
      nodePathMap,
    }
  }

  // File-level view with cluster subgraphs and role-based coloring
  const clusterFiles = new Map<number, string[]>()
  const unclusteredFiles: string[] = []

  for (const [path] of files) {
    const ci = nodeCluster.get(path)
    if (ci !== undefined) {
      if (!clusterFiles.has(ci)) clusterFiles.set(ci, [])
      clusterFiles.get(ci)!.push(path)
    } else {
      unclusteredFiles.push(path)
    }
  }

  // Render clustered files in subgraphs
  for (const [ci, paths] of clusterFiles) {
    if (paths.length < 2) {
      // Don't subgraph singletons
      for (const p of paths) {
        const id = sanitizeId(p)
        const name = p.split('/').pop() || p
        const role = roleMap.get(p) || 'regular'
        chart += `  ${id}["${name}"]:::${role}Style\n`
        nodePathMap.set(id, p)
      }
      continue
    }
    chart += `  subgraph cluster_${ci}["Cluster ${ci + 1} (${paths.length} files)"]\n`
    for (const p of paths) {
      const id = sanitizeId(p)
      const name = p.split('/').pop() || p
      const role = roleMap.get(p) || 'regular'
      chart += `    ${id}["${name}"]:::${role}Style\n`
      nodePathMap.set(id, p)
    }
    chart += '  end\n'
  }

  // Unclustered files
  for (const p of unclusteredFiles) {
    const id = sanitizeId(p)
    const name = p.split('/').pop() || p
    const role = roleMap.get(p) || 'orphan'
    chart += `  ${id}["${name}"]:::${role}Style\n`
    nodePathMap.set(id, p)
  }

  chart += '\n'

  // Edges
  const circularSet = new Set(graph.circular.map(([a, b]) => `${a}|${b}`))
  for (const [from, deps] of graph.edges) {
    const fromId = sanitizeId(from)
    for (const to of deps) {
      const toId = sanitizeId(to)
      const isCircular = circularSet.has(`${from}|${to}`) || circularSet.has(`${to}|${from}`)
      if (isCircular) chart += `  ${fromId} -. "circular" .-> ${toId}\n`
      else chart += `  ${fromId} --> ${toId}\n`
    }
  }

  chart += '\n'
  chart += '  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
  chart += '  classDef hubStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
  chart += '  classDef connectorStyle fill:#a855f7,stroke:#c084fc,color:#fff\n'
  chart += '  classDef leafStyle fill:#6b7280,stroke:#9ca3af,color:#fff\n'
  chart += '  classDef orphanStyle fill:#374151,stroke:#4b5563,color:#9ca3af\n'
  chart += '  classDef regularStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'

  return {
    type: 'topology',
    title: `Architecture — Topology (${files.size} files, ${topology.clusters.length} clusters)`,
    chart,
    stats: { totalNodes: files.size, ...commonStats } as DiagramStats,
    nodePathMap,
  }
}
