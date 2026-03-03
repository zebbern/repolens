// Generator — Treemap

import type { CodeIndex } from '@/lib/code/code-index'
import type { FileNode } from '@/types/repository'
import type { TreemapDiagramResult, TreemapNode } from '../types'

export function generateTreemap(codeIndex: CodeIndex, files: FileNode[]): TreemapDiagramResult {
  function buildNode(node: FileNode): TreemapNode | null {
    if (node.type === 'file') {
      const indexed = codeIndex.files.get(node.path)
      const lines = indexed?.lineCount || 0
      if (lines === 0) return null
      return { path: node.path, name: node.name, lines, language: indexed?.language }
    }
    if (!node.children) return null
    const children = node.children.map(c => buildNode(c)).filter((c): c is TreemapNode => c !== null)
    if (children.length === 0) return null
    return { path: node.path, name: node.name, lines: children.reduce((s, c) => s + c.lines, 0), children }
  }

  const data = files.map(f => buildNode(f)).filter((n): n is TreemapNode => n !== null)
  let largest: { path: string; count: number } | undefined
  for (const [path, file] of codeIndex.files) {
    if (!largest || file.lineCount > largest.count) largest = { path, count: file.lineCount }
  }

  return {
    type: 'treemap',
    title: `File Size Treemap (${codeIndex.totalFiles} files, ${codeIndex.totalLines.toLocaleString()} lines)`,
    data,
    stats: { totalNodes: codeIndex.totalFiles, totalEdges: 0, mostImported: largest },
  }
}
