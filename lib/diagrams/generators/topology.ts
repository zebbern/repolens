// Generator — Topology Architecture (graph-role-based, not folder-name-based)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult, DiagramStats } from '../types'
import { sanitizeId, getTopDir, computeCommonStats, escapeMermaidLabel, MERMAID_EDGE_BUDGET, MERMAID_SOURCE_BUDGET } from '../helpers'

export function generateTopologyDiagram(analysis: FullAnalysis): MermaidDiagramResult {
  const { graph, topology, files } = analysis
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

    const allDirEdges = [...dirEdges.entries()].flatMap(([fromDir, targets]) =>
      [...targets.entries()].map(([toDir, count]) => ({ fromDir, toDir, count })))
      .sort((a, b) => `${a.fromDir}|${a.toDir}`.localeCompare(`${b.fromDir}|${b.toDir}`))
    const dirConnectivity = new Map<string, number>()
    for (const { fromDir, toDir, count } of allDirEdges) {
      dirConnectivity.set(fromDir, (dirConnectivity.get(fromDir) || 0) + count)
      dirConnectivity.set(toDir, (dirConnectivity.get(toDir) || 0) + count)
    }
    const rolePriority = new Map(['entry', 'hub', 'connector', 'regular', 'leaf', 'orphan'].map((role, index) => [role, index]))
    const rankedDirs = [...dirInfo.keys()].sort((left, right) => {
      const connectivityDifference = (dirConnectivity.get(right) || 0) - (dirConnectivity.get(left) || 0)
      if (connectivityDifference !== 0) return connectivityDifference
      const roleDifference = (rolePriority.get(dirRole.get(left)!) ?? 3) - (rolePriority.get(dirRole.get(right)!) ?? 3)
      if (roleDifference !== 0) return roleDifference
      const countDifference = dirInfo.get(right)!.count - dirInfo.get(left)!.count
      return countDifference || left.localeCompare(right)
    })
    const edgeOrderedDirs: string[] = []
    const edgeOrderedSet = new Set<string>()
    const rankedDirEdges = [...allDirEdges].sort((left, right) => {
      const leftConnectivity = (dirConnectivity.get(left.fromDir) || 0) + (dirConnectivity.get(left.toDir) || 0)
      const rightConnectivity = (dirConnectivity.get(right.fromDir) || 0) + (dirConnectivity.get(right.toDir) || 0)
      return rightConnectivity - leftConnectivity || right.count - left.count ||
        `${left.fromDir}|${left.toDir}`.localeCompare(`${right.fromDir}|${right.toDir}`)
    })
    for (const { fromDir, toDir } of rankedDirEdges) {
      for (const dir of [toDir, fromDir]) {
        if (dirInfo.has(dir) && !edgeOrderedSet.has(dir)) {
          edgeOrderedSet.add(dir)
          edgeOrderedDirs.push(dir)
        }
      }
    }
    const orderedDirs = [...edgeOrderedDirs, ...rankedDirs.filter(dir => !edgeOrderedSet.has(dir))]
    const render = (maxNodes: number) => {
      const selectedDirs = orderedDirs.slice(0, maxNodes)
      const selected = new Set(selectedDirs)
      const renderedMap = new Map<string, string>()
      let renderedChart = 'flowchart TD\n'
      for (const dir of selectedDirs) {
        const info = dirInfo.get(dir)!
        const rawLabel = `${dir}/ (${info.count} files)`
        const label = rawLabel.length > 120 ? `${rawLabel.slice(0, 117)}...` : rawLabel
        const id = sanitizeId(dir)
        renderedChart += `  ${id}["${escapeMermaidLabel(label)}"]:::${dirRole.get(dir)!}Style\n`
        renderedMap.set(id, dir)
      }
      const eligibleEdges = allDirEdges.filter(({ fromDir, toDir }) => selected.has(fromDir) && selected.has(toDir))
      const renderedEdges = eligibleEdges.slice(0, MERMAID_EDGE_BUDGET)
      for (const { fromDir, toDir, count } of renderedEdges) {
        renderedChart += `  ${sanitizeId(fromDir)} -->|"${count}"| ${sanitizeId(toDir)}\n`
      }
      const omittedNodes = dirInfo.size - selected.size
      const omittedEdges = allDirEdges.length - renderedEdges.length
      if (omittedNodes > 0 || omittedEdges > 0) renderedChart += `  %% ${omittedNodes} nodes and ${omittedEdges} edges omitted\n`
      renderedChart += '\n'
      renderedChart += '  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
      renderedChart += '  classDef hubStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
      renderedChart += '  classDef connectorStyle fill:#a855f7,stroke:#c084fc,color:#fff\n'
      renderedChart += '  classDef leafStyle fill:#6b7280,stroke:#9ca3af,color:#fff\n'
      renderedChart += '  classDef orphanStyle fill:#374151,stroke:#4b5563,color:#9ca3af\n'
      renderedChart += '  classDef regularStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'
      return { chart: renderedChart, nodePathMap: renderedMap, nodeCount: selected.size, edgeCount: renderedEdges.length, omittedNodes, omittedEdges }
    }

    let low = 1
    let high = orderedDirs.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (render(mid).chart.length <= MERMAID_SOURCE_BUDGET) low = mid
      else high = mid - 1
    }
    const rendered = render(low)

    return {
      type: 'topology',
      title: `Architecture (${rendered.nodeCount}${rendered.omittedNodes > 0 ? ` of ${dirInfo.size}` : ''} directories, ${files.size} files)`,
      chart: rendered.chart,
      stats: { ...commonStats, totalNodes: rendered.nodeCount, totalEdges: rendered.edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges } as DiagramStats,
      nodePathMap: rendered.nodePathMap,
    }
  }

  const circularSet = new Set(graph.circular.map(([a, b]) => `${a}|${b}`))
  const allEdges = [...graph.edges.entries()].flatMap(([from, deps]) => [...deps].map(to => ({ from, to })))
    .sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`))
  const rolePriority = new Map(['entry', 'hub', 'connector', 'regular', 'leaf', 'orphan'].map((role, index) => [role, index]))
  const rankedPaths = [...files.keys()].sort((left, right) => {
    const leftDegree = (graph.edges.get(left)?.size || 0) + (graph.reverseEdges.get(left)?.size || 0)
    const rightDegree = (graph.edges.get(right)?.size || 0) + (graph.reverseEdges.get(right)?.size || 0)
    const degreeDifference = rightDegree - leftDegree
    if (degreeDifference !== 0) return degreeDifference
    const roleDifference = (rolePriority.get(roleMap.get(left)!) ?? 3) - (rolePriority.get(roleMap.get(right)!) ?? 3)
    return roleDifference || left.localeCompare(right)
  })
  const fileDegree = new Map<string, number>()
  for (const { from, to } of allEdges) {
    fileDegree.set(from, (fileDegree.get(from) || 0) + 1)
    fileDegree.set(to, (fileDegree.get(to) || 0) + 1)
  }
  const rankedEdges = [...allEdges].sort((left, right) => {
    const leftDegree = (fileDegree.get(left.from) || 0) + (fileDegree.get(left.to) || 0)
    const rightDegree = (fileDegree.get(right.from) || 0) + (fileDegree.get(right.to) || 0)
    return rightDegree - leftDegree || `${left.from}|${left.to}`.localeCompare(`${right.from}|${right.to}`)
  })
  const edgeOrderedPaths: string[] = []
  const edgeOrderedSet = new Set<string>()
  for (const { from, to } of rankedEdges) {
    for (const path of [to, from]) {
      if (files.has(path) && !edgeOrderedSet.has(path)) {
        edgeOrderedSet.add(path)
        edgeOrderedPaths.push(path)
      }
    }
  }
  const orderedPaths = [...edgeOrderedPaths, ...rankedPaths.filter(path => !edgeOrderedSet.has(path))]

  const render = (maxNodes: number) => {
    const selectedPaths = orderedPaths.slice(0, maxNodes)
    const selected = new Set(selectedPaths)
    const selectedClusterFiles = new Map<number, string[]>()
    const selectedUnclusteredFiles: string[] = []
    const renderedMap = new Map<string, string>()

    for (const path of selectedPaths) {
      const clusterIndex = nodeCluster.get(path)
      if (clusterIndex === undefined) {
        selectedUnclusteredFiles.push(path)
      } else {
        const paths = selectedClusterFiles.get(clusterIndex) || []
        paths.push(path)
        selectedClusterFiles.set(clusterIndex, paths)
      }
    }

    let renderedChart = 'flowchart TD\n'
    for (const [clusterIndex, paths] of [...selectedClusterFiles.entries()].sort(([left], [right]) => left - right)) {
      if (paths.length >= 2) {
        renderedChart += `  subgraph cluster_${clusterIndex}["Cluster ${clusterIndex + 1} (${paths.length} files shown)"]\n`
      }
      for (const path of paths) {
        const id = sanitizeId(path)
        const rawName = path.split('/').pop() || path
        const name = rawName.length > 120 ? `${rawName.slice(0, 117)}...` : rawName
        const role = roleMap.get(path) || 'regular'
        renderedChart += `${paths.length >= 2 ? '    ' : '  '}${id}["${escapeMermaidLabel(name)}"]:::${role}Style\n`
        renderedMap.set(id, path)
      }
      if (paths.length >= 2) renderedChart += '  end\n'
    }

    for (const path of selectedUnclusteredFiles) {
      const id = sanitizeId(path)
      const rawName = path.split('/').pop() || path
      const name = rawName.length > 120 ? `${rawName.slice(0, 117)}...` : rawName
      const role = roleMap.get(path) || 'orphan'
      renderedChart += `  ${id}["${escapeMermaidLabel(name)}"]:::${role}Style\n`
      renderedMap.set(id, path)
    }

    renderedChart += '\n'
    const eligibleEdges = allEdges.filter(({ from, to }) => selected.has(from) && selected.has(to))
    const renderedEdges = eligibleEdges.slice(0, MERMAID_EDGE_BUDGET)
    for (const { from, to } of renderedEdges) {
      const fromId = sanitizeId(from)
      const toId = sanitizeId(to)
      const isCircular = circularSet.has(`${from}|${to}`) || circularSet.has(`${to}|${from}`)
      if (isCircular) renderedChart += `  ${fromId} -. "circular" .-> ${toId}\n`
      else renderedChart += `  ${fromId} --> ${toId}\n`
    }

    const omittedNodes = files.size - selected.size
    const omittedEdges = allEdges.length - renderedEdges.length
    if (omittedNodes > 0 || omittedEdges > 0) renderedChart += `  %% ${omittedNodes} nodes and ${omittedEdges} edges omitted\n`

    renderedChart += '\n'
    renderedChart += '  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
    renderedChart += '  classDef hubStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
    renderedChart += '  classDef connectorStyle fill:#a855f7,stroke:#c084fc,color:#fff\n'
    renderedChart += '  classDef leafStyle fill:#6b7280,stroke:#9ca3af,color:#fff\n'
    renderedChart += '  classDef orphanStyle fill:#374151,stroke:#4b5563,color:#9ca3af\n'
    renderedChart += '  classDef regularStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'

    return {
      chart: renderedChart,
      nodePathMap: renderedMap,
      nodeCount: selected.size,
      edgeCount: renderedEdges.length,
      omittedNodes,
      omittedEdges,
    }
  }

  let rendered = render(0)
  for (let maxNodes = orderedPaths.length; maxNodes >= 0; maxNodes--) {
    const candidate = render(maxNodes)
    if (candidate.chart.length <= MERMAID_SOURCE_BUDGET) {
      rendered = candidate
      break
    }
  }

  return {
    type: 'topology',
    title: `Architecture — Topology (${rendered.nodeCount}${rendered.omittedNodes > 0 ? ` of ${files.size}` : ''} files, ${topology.clusters.length} clusters)`,
    chart: rendered.chart,
    stats: { ...commonStats, totalNodes: rendered.nodeCount, totalEdges: rendered.edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges } as DiagramStats,
    nodePathMap: rendered.nodePathMap,
  }
}
