// Circular dependency detection via depth-first search.

export function detectCircularDeps(edges: Map<string, Set<string>>): [string, string][] {
  const circular: [string, string][] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const seenPairs = new Set<string>()

  function dfs(node: string, path: string[]) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node)
      if (cycleStart >= 0) {
        for (let i = cycleStart; i < path.length; i++) {
          const a = path[i]
          const b = path[i + 1] || node
          const key = [a, b].sort().join('|')
          if (!seenPairs.has(key)) { seenPairs.add(key); circular.push([a, b]) }
        }
      }
      return
    }
    if (visited.has(node)) return
    visited.add(node)
    inStack.add(node)
    const deps = edges.get(node)
    if (deps) for (const dep of deps) dfs(dep, [...path, node])
    inStack.delete(node)
  }

  for (const node of edges.keys()) dfs(node, [])
  return circular
}
