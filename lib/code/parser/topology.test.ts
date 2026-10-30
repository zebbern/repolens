import { computeTopology } from '@/lib/code/parser/topology'
import type { DependencyGraph } from '@/lib/code/parser/types'

function makeGraph(edgeList: [string, string[]][]): DependencyGraph {
  const edges = new Map<string, Set<string>>()
  const reverseEdges = new Map<string, Set<string>>()
  const allPaths = new Set<string>()

  for (const [from, tos] of edgeList) {
    allPaths.add(from)
    if (!edges.has(from)) edges.set(from, new Set())
    for (const to of tos) {
      allPaths.add(to)
      edges.get(from)!.add(to)
      if (!reverseEdges.has(to)) reverseEdges.set(to, new Set())
      reverseEdges.get(to)!.add(from)
    }
  }

  return {
    edges,
    reverseEdges,
    circular: [],
    externalDeps: new Map(),
  }
}

describe('computeTopology', () => {
  it('identifies entry points (no incoming, some outgoing)', () => {
    const graph = makeGraph([
      ['entry.ts', ['a.ts', 'b.ts']],
      ['a.ts', ['c.ts']],
      ['b.ts', ['c.ts']],
      ['c.ts', []],
    ])
    const allPaths = ['entry.ts', 'a.ts', 'b.ts', 'c.ts']
    const result = computeTopology(graph, allPaths)
    expect(result.entryPoints).toContain('entry.ts')
  })

  it('identifies hubs (most imported)', () => {
    const graph = makeGraph([
      ['a.ts', ['shared.ts']],
      ['b.ts', ['shared.ts']],
      ['c.ts', ['shared.ts']],
      ['d.ts', ['shared.ts']],
      ['shared.ts', []],
    ])
    const allPaths = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'shared.ts']
    const result = computeTopology(graph, allPaths)
    expect(result.hubs).toContain('shared.ts')
  })

  it('identifies orphans (no edges)', () => {
    const graph = makeGraph([
      ['a.ts', ['b.ts']],
      ['b.ts', []],
    ])
    const allPaths = ['a.ts', 'b.ts', 'orphan.ts']
    const result = computeTopology(graph, allPaths)
    expect(result.orphans).toContain('orphan.ts')
  })

  it('identifies leaf nodes (incoming only, no outgoing)', () => {
    const graph = makeGraph([
      ['entry.ts', ['leaf.ts']],
      ['leaf.ts', []],
    ])
    const allPaths = ['entry.ts', 'leaf.ts']
    const result = computeTopology(graph, allPaths)
    expect(result.leafNodes).toContain('leaf.ts')
  })

  it('computes clusters for connected components', () => {
    // Two disconnected components
    const graph = makeGraph([
      ['a.ts', ['b.ts']],
      ['b.ts', []],
      ['c.ts', ['d.ts']],
      ['d.ts', []],
    ])
    const allPaths = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    const result = computeTopology(graph, allPaths)
    expect(result.clusters.length).toBeGreaterThanOrEqual(2)
  })

  it('computes depth map via BFS from entry points', () => {
    const graph = makeGraph([
      ['entry.ts', ['mid.ts']],
      ['mid.ts', ['leaf.ts']],
      ['leaf.ts', []],
    ])
    const allPaths = ['entry.ts', 'mid.ts', 'leaf.ts']
    const result = computeTopology(graph, allPaths)
    // entry is depth 0, mid is depth 1, leaf is depth 2
    expect(result.maxDepth).toBeGreaterThanOrEqual(2)
    expect(result.depthMap.get('leaf.ts')).toBe(2)
  })

  it('identifies connectors (articulation points)', () => {
    // bridge topology: a-b-c where b is the bridge
    const graph = makeGraph([
      ['a.ts', ['b.ts']],
      ['b.ts', ['c.ts']],
      ['c.ts', []],
    ])
    const allPaths = ['a.ts', 'b.ts', 'c.ts']
    const result = computeTopology(graph, allPaths)
    // b.ts should be an articulation point
    expect(result.connectors).toContain('b.ts')
  })

  it('handles empty graph', () => {
    const graph = makeGraph([])
    const result = computeTopology(graph, [])
    expect(result.entryPoints).toHaveLength(0)
    expect(result.hubs).toHaveLength(0)
    expect(result.orphans).toHaveLength(0)
    expect(result.maxDepth).toBe(0)
  })

  it('handles single node', () => {
    const graph = makeGraph([])
    const result = computeTopology(graph, ['solo.ts'])
    expect(result.orphans).toContain('solo.ts')
  })

  it('keeps allPaths order among ties and interleaved orphans', () => {
    const graph = makeGraph([
      ['e1.ts', ['h1.ts', 'h2.ts']],
      ['e2.ts', ['h2.ts', 'h1.ts']],
      ['e3.ts', ['h3.ts']],
      ['e4.ts', ['h3.ts', 'h1.ts']],
      ['h1.ts', ['l1.ts']],
      ['h2.ts', ['l1.ts', 'deep/a.ts']],
      ['h3.ts', ['l1.ts']],
      ['deep/a.ts', ['deep/b.ts']],
      ['deep/b.ts', ['deep/c.ts']],
    ])
    const allPaths = [
      'o1.ts', 'e2.ts', 'h3.ts', 'o2.ts', 'e1.ts', 'l1.ts', 'h2.ts', 'e4.ts',
      'o3.ts', 'deep/c.ts', 'h1.ts', 'e3.ts', 'deep/b.ts', 'o4.ts', 'deep/a.ts',
    ]
    const result = computeTopology(graph, allPaths)
    expect({ ...result, depthMap: [...result.depthMap] }).toMatchInlineSnapshot(`
      {
        "clusters": [
          [
            "e2.ts",
            "h3.ts",
            "e1.ts",
            "l1.ts",
            "h2.ts",
            "e4.ts",
            "deep/c.ts",
            "h1.ts",
            "e3.ts",
            "deep/b.ts",
            "deep/a.ts",
          ],
        ],
        "connectors": [
          "h3.ts",
          "deep/b.ts",
          "deep/a.ts",
          "h2.ts",
        ],
        "depthMap": [
          [
            "h2.ts",
            1,
          ],
          [
            "h1.ts",
            1,
          ],
          [
            "l1.ts",
            2,
          ],
          [
            "deep/a.ts",
            2,
          ],
          [
            "deep/b.ts",
            3,
          ],
          [
            "deep/c.ts",
            4,
          ],
          [
            "h3.ts",
            1,
          ],
        ],
        "entryPoints": [
          "e2.ts",
          "e1.ts",
          "e4.ts",
          "e3.ts",
        ],
        "hubs": [
          "l1.ts",
          "h1.ts",
        ],
        "leafNodes": [
          "l1.ts",
          "deep/c.ts",
        ],
        "maxDepth": 4,
        "orphans": [
          "o1.ts",
          "o2.ts",
          "o3.ts",
          "o4.ts",
        ],
      }
    `)
  })
})
