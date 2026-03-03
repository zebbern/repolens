// Topology analysis — entry points, hubs, orphans, leaf nodes, connectors, clusters.

import type { DependencyGraph, TopologyAnalysis } from './types'

export function computeTopology(graph: DependencyGraph, allPaths: string[]): TopologyAnalysis {
  const { edges, reverseEdges } = graph
  const allNodes = new Set(allPaths)

  // Degree counts
  const outDegree = new Map<string, number>()
  const inDegree = new Map<string, number>()
  for (const n of allNodes) {
    outDegree.set(n, edges.get(n)?.size || 0)
    inDegree.set(n, reverseEdges.get(n)?.size || 0)
  }

  // Orphans: no edges in either direction
  const orphans: string[] = []
  for (const n of allNodes) {
    if ((outDegree.get(n) || 0) === 0 && (inDegree.get(n) || 0) === 0) orphans.push(n)
  }

  // Entry points: high outgoing, low incoming (top files by out/in ratio)
  const nonOrphan = allPaths.filter(n => !orphans.includes(n))
  const entryPoints = nonOrphan
    .filter(n => (outDegree.get(n) || 0) > 0 && (inDegree.get(n) || 0) === 0)
    .sort((a, b) => (outDegree.get(b) || 0) - (outDegree.get(a) || 0))
    .slice(0, 20)

  // Hubs: top 10% by incoming edges (most-imported)
  const hubThreshold = Math.max(2, Math.ceil(nonOrphan.length * 0.1))
  const hubs = nonOrphan
    .filter(n => (inDegree.get(n) || 0) >= 2)
    .sort((a, b) => (inDegree.get(b) || 0) - (inDegree.get(a) || 0))
    .slice(0, hubThreshold)

  // Leaf nodes: only incoming, no outgoing project-internal deps
  const leafNodes = nonOrphan
    .filter(n => (inDegree.get(n) || 0) > 0 && (outDegree.get(n) || 0) === 0)

  // Clusters via union-find on undirected graph
  const parent = new Map<string, string>()
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const n of allNodes) find(n) // Init
  for (const [from, deps] of edges) {
    for (const to of deps) union(from, to)
  }

  const clusterMap = new Map<string, string[]>()
  for (const n of allNodes) {
    const root = find(n)
    if (!clusterMap.has(root)) clusterMap.set(root, [])
    clusterMap.get(root)!.push(n)
  }
  const clusters = Array.from(clusterMap.values()).filter(c => c.length > 1).sort((a, b) => b.length - a.length)

  // Connectors: articulation points via simplified Tarjan's on undirected graph
  const connectors: string[] = []
  const disc = new Map<string, number>()
  const low = new Map<string, number>()
  const parentMap = new Map<string, string | null>()
  const articulationSet = new Set<string>()
  let timer = 0

  // Build undirected adjacency
  const undirected = new Map<string, Set<string>>()
  for (const n of allNodes) undirected.set(n, new Set())
  for (const [from, deps] of edges) {
    for (const to of deps) {
      undirected.get(from)?.add(to)
      undirected.get(to)?.add(from)
    }
  }

  function tarjanDfs(u: string) {
    disc.set(u, timer)
    low.set(u, timer)
    timer++
    let children = 0

    for (const v of undirected.get(u) || []) {
      if (!disc.has(v)) {
        children++
        parentMap.set(v, u)
        tarjanDfs(v)
        low.set(u, Math.min(low.get(u)!, low.get(v)!))
        // u is articulation if:
        if (parentMap.get(u) === null && children > 1) articulationSet.add(u)
        if (parentMap.get(u) !== null && low.get(v)! >= disc.get(u)!) articulationSet.add(u)
      } else if (v !== parentMap.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!))
      }
    }
  }

  for (const n of allNodes) {
    if (!disc.has(n)) {
      parentMap.set(n, null)
      tarjanDfs(n)
    }
  }
  connectors.push(...articulationSet)

  // Depth map: BFS from entry points
  const depthMap = new Map<string, number>()
  let maxDepth = 0

  for (const entry of entryPoints) {
    const queue: [string, number][] = [[entry, 0]]
    const visited = new Set<string>([entry])
    while (queue.length > 0) {
      const [node, depth] = queue.shift()!
      const current = depthMap.get(node) || 0
      if (depth > current) depthMap.set(node, depth)
      if (depth > maxDepth) maxDepth = depth

      const deps = edges.get(node)
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) {
            visited.add(dep)
            queue.push([dep, depth + 1])
          }
        }
      }
    }
  }

  return { entryPoints, hubs, orphans, leafNodes, connectors, clusters, depthMap, maxDepth }
}
