import type { TreemapNode } from '@/lib/diagrams/diagram-data'

export type TreemapRect = { node: TreemapNode; x: number; y: number; w: number; h: number }

/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk 2000).
 *
 * Key insight: the algorithm works with **values** (line counts), not
 * pre-computed pixel areas.  At each step it scales values into the
 * *current* remaining rectangle so the entire container is always filled.
 */
export function layoutTreemap(
  nodes: TreemapNode[], x: number, y: number, w: number, h: number,
): TreemapRect[] {
  // Flatten to leaf files
  const leaves: TreemapNode[] = []
  const flatten = (ns: TreemapNode[]) => {
    for (const n of ns) {
      if (n.children && n.children.length > 0) flatten(n.children)
      else if (n.lines > 0) leaves.push(n)
    }
  }
  flatten(nodes)
  leaves.sort((a, b) => b.lines - a.lines)
  if (leaves.length === 0) return []

  const values = leaves.map(n => n.lines)
  return squarify(leaves, values, x, y, w, h)
}

function squarify(
  nodes: TreemapNode[], values: number[], x: number, y: number, w: number, h: number,
): TreemapRect[] {
  if (nodes.length === 0 || w < 1 || h < 1) return []
  if (nodes.length === 1) return [{ node: nodes[0], x, y, w, h }]

  const totalVal = values.reduce((a, b) => a + b, 0)
  if (totalVal <= 0) return []

  const rects: TreemapRect[] = []
  let cx = x, cy = y, cw = w, ch = h
  let remaining = totalVal
  let i = 0

  while (i < nodes.length) {
    const shortSide = Math.min(cw, ch)
    if (shortSide < 1) break

    // Build a row greedily: keep adding nodes while worst-aspect improves
    const row: number[] = [] // indices into nodes/values
    let rowValSum = 0

    // Scale factor: how many px^2 per unit of value in current rect
    const scale = (cw * ch) / remaining

    row.push(i)
    rowValSum = values[i]

    while (i + row.length < nodes.length) {
      const ni = i + row.length
      const testSum = rowValSum + values[ni]
      if (worstRatio(row.map(r => values[r] * scale), rowValSum * scale, shortSide) >=
          worstRatio([...row.map(r => values[r] * scale), values[ni] * scale], testSum * scale, shortSide)) {
        row.push(ni)
        rowValSum = testSum
      } else {
        break
      }
    }

    // Lay out this row
    const rowArea = rowValSum * scale
    const thickness = rowArea / shortSide
    // When landscape (cw >= ch), shortSide=ch, nodes span the height → vertical column
    // When portrait  (ch > cw),  shortSide=cw, nodes span the width  → horizontal row
    const isHoriz = ch > cw

    let offset = 0
    for (const ri of row) {
      const nodeArea = values[ri] * scale
      const nodeLen = nodeArea / thickness
      if (isHoriz) {
        rects.push({ node: nodes[ri], x: cx + offset, y: cy, w: nodeLen, h: thickness })
      } else {
        rects.push({ node: nodes[ri], x: cx, y: cy + offset, w: thickness, h: nodeLen })
      }
      offset += nodeLen
    }

    // Shrink remaining rectangle
    if (isHoriz) {
      cy += thickness
      ch -= thickness
    } else {
      cx += thickness
      cw -= thickness
    }
    remaining -= rowValSum
    i += row.length
  }

  return rects
}

/** Worst (max) aspect ratio among rectangles in a row. Lower = better. */
function worstRatio(areas: number[], totalArea: number, shortSide: number): number {
  if (areas.length === 0 || totalArea <= 0 || shortSide <= 0) return Infinity
  const thickness = totalArea / shortSide
  let worst = 0
  for (const a of areas) {
    const len = a / thickness
    if (len <= 0) continue
    const r = Math.max(thickness / len, len / thickness)
    if (r > worst) worst = r
  }
  return worst
}
