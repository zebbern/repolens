// Diagram Generators — barrel export + master dispatcher

import type { CodeIndex } from '@/lib/code/code-index'
import type { FileNode } from '@/types/repository'
import { analyzeCodebase, type FullAnalysis } from '@/lib/code/import-parser'
import type { DiagramType, AnyDiagramResult } from '../types'

import { generateProjectSummary } from './summary'
import { generateTopologyDiagram } from './topology'
import { generateImportGraph } from './import-graph'
import { generateClassDiagram } from './class-diagram'
import { generateEntryPoints } from './entry-points'
import { generateModuleUsageTree } from './module-usage'
import { generateTreemap } from './treemap'
import { generateExternalDeps } from './external-deps'
import { generateFocusDiagram } from './focus-diagram'

export {
  generateProjectSummary,
  generateTopologyDiagram,
  generateImportGraph,
  generateClassDiagram,
  generateEntryPoints,
  generateModuleUsageTree,
  generateTreemap,
  generateExternalDeps,
  generateFocusDiagram,
}

export async function generateDiagram(
  type: DiagramType,
  codeIndex: CodeIndex,
  files: FileNode[],
  analysis?: FullAnalysis,
  focusTarget?: string,
  focusHops?: 1 | 2,
): Promise<AnyDiagramResult> {
  const data = analysis || await analyzeCodebase(codeIndex)

  switch (type) {
    case 'topology':
      return generateTopologyDiagram(data)
    case 'imports':
      return generateImportGraph(data)
    case 'classes':
      return generateClassDiagram(data)
    case 'entrypoints':
      return generateEntryPoints(data, codeIndex, files)
    case 'modules':
      return generateModuleUsageTree(data)
    case 'treemap':
      return generateTreemap(codeIndex, files)
    case 'externals':
      return generateExternalDeps(data)
    case 'focus':
      return generateFocusDiagram(data, focusTarget || '', focusHops || 1)
    default:
      return generateTopologyDiagram(data)
  }
}

/**
 * Async diagram dispatcher — uses Tree-sitter–enhanced analysis for class
 * diagrams on non-JS/TS repos. Falls back to sync path for other diagram types.
 */
export async function generateDiagramAsync(
  type: DiagramType,
  codeIndex: CodeIndex,
  files: FileNode[],
  analysis?: FullAnalysis,
  focusTarget?: string,
  focusHops?: 1 | 2,
): Promise<AnyDiagramResult> {
  if (type === 'classes') {
    const { analyzeCodebaseAsync } = await import('@/lib/code/parser/analyzer')
    const asyncAnalysis = await analyzeCodebaseAsync(codeIndex)
    return generateClassDiagram(asyncAnalysis)
  }

  return generateDiagram(type, codeIndex, files, analysis, focusTarget, focusHops)
}
