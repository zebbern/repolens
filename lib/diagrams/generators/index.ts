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

export function generateDiagram(
  type: DiagramType,
  codeIndex: CodeIndex,
  files: FileNode[],
  analysis?: FullAnalysis,
  focusTarget?: string,
  focusHops?: 1 | 2,
): AnyDiagramResult {
  const data = analysis || analyzeCodebase(codeIndex)

  switch (type) {
    case 'summary':
      return generateProjectSummary(data, codeIndex)
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
      return generateProjectSummary(data, codeIndex)
  }
}
