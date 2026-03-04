import { describe, it, expect } from 'vitest'
import { layoutTreemap } from './treemap-layout'
import type { TreemapNode } from '@/lib/diagrams/diagram-data'

function makeNode(path: string, lines: number, language?: string): TreemapNode {
  return { path, name: path.split('/').pop() || path, lines, language }
}

describe('layoutTreemap', () => {
  it('returns empty array for empty nodes', () => {
    expect(layoutTreemap([], 0, 0, 400, 300)).toEqual([])
  })

  it('returns single rect filling the container for one node', () => {
    const nodes = [makeNode('src/index.ts', 100)]
    const rects = layoutTreemap(nodes, 0, 0, 400, 300)

    expect(rects).toHaveLength(1)
    expect(rects[0].x).toBe(0)
    expect(rects[0].y).toBe(0)
    expect(rects[0].w).toBe(400)
    expect(rects[0].h).toBe(300)
    expect(rects[0].node.path).toBe('src/index.ts')
  })

  it('total area of rects equals container area', () => {
    const WIDTH = 800
    const HEIGHT = 600
    const nodes = [
      makeNode('a.ts', 200),
      makeNode('b.ts', 100),
      makeNode('c.ts', 50),
      makeNode('d.ts', 25),
    ]
    const rects = layoutTreemap(nodes, 0, 0, WIDTH, HEIGHT)

    const totalArea = rects.reduce((sum, r) => sum + r.w * r.h, 0)
    expect(totalArea).toBeCloseTo(WIDTH * HEIGHT, -1)
  })

  it('larger files get proportionally more area', () => {
    const nodes = [
      makeNode('big.ts', 300),
      makeNode('small.ts', 100),
    ]
    const rects = layoutTreemap(nodes, 0, 0, 400, 300)

    const bigRect = rects.find(r => r.node.path === 'big.ts')!
    const smallRect = rects.find(r => r.node.path === 'small.ts')!

    expect(bigRect.w * bigRect.h).toBeGreaterThan(smallRect.w * smallRect.h)
  })

  it('flattens nested children to leaf nodes', () => {
    const nodes: TreemapNode[] = [
      {
        path: 'src',
        name: 'src',
        lines: 0,
        children: [
          makeNode('src/a.ts', 100),
          makeNode('src/b.ts', 50),
        ],
      },
    ]
    const rects = layoutTreemap(nodes, 0, 0, 400, 300)

    expect(rects).toHaveLength(2)
    expect(rects.map(r => r.node.path).sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('skips nodes with zero lines', () => {
    const nodes = [
      makeNode('empty.ts', 0),
      makeNode('real.ts', 100),
    ]
    const rects = layoutTreemap(nodes, 0, 0, 400, 300)

    expect(rects).toHaveLength(1)
    expect(rects[0].node.path).toBe('real.ts')
  })

  it('uses provided x/y offset', () => {
    const nodes = [makeNode('a.ts', 100)]
    const rects = layoutTreemap(nodes, 50, 100, 400, 300)

    expect(rects[0].x).toBe(50)
    expect(rects[0].y).toBe(100)
  })

  it('produces non-overlapping rects', () => {
    const nodes = [
      makeNode('a.ts', 200),
      makeNode('b.ts', 150),
      makeNode('c.ts', 100),
      makeNode('d.ts', 80),
      makeNode('e.ts', 60),
    ]
    const rects = layoutTreemap(nodes, 0, 0, 600, 400)

    // Check no pair of rects overlaps
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlapsX = a.x < b.x + b.w && a.x + a.w > b.x
        const overlapsY = a.y < b.y + b.h && a.y + a.h > b.y
        // at least one axis must separate
        expect(overlapsX && overlapsY).toBe(false)
      }
    }
  })
})
