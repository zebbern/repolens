/**
 * JSON export — serialize analysis data into a downloadable JSON file.
 */

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { ScanResults } from '@/lib/code/issue-scanner'
import type { CodeIndex } from '@/lib/code/code-index'
import type { GitHubRepo, RepositoryCoverage } from '@/types/repository'

export interface ExportableAnalysis {
  meta: {
    exportedAt: string
    repoFullName: string
    repoUrl: string
    totalFiles: number
    totalLines: number
    coverage?: RepositoryCoverage
  }
  analysis: SerializedFullAnalysis | null
  issues: SerializedScanResults | null
}

/** FullAnalysis with Map/Set converted to plain objects for JSON serialization. */
interface SerializedFullAnalysis {
  detectedFramework: string | null
  primaryLanguage: string
  files: Record<string, unknown>
  graph: {
    edges: Record<string, string[]>
    reverseEdges: Record<string, string[]>
    circular: [string, string][]
    externalDeps: Record<string, string[]>
  }
  topology: {
    entryPoints: string[]
    hubs: string[]
    orphans: string[]
    leafNodes: string[]
    connectors: string[]
    clusters: string[][]
    maxDepth: number
  }
}

interface SerializedScanResults {
  issues: ScanResults['issues']
  summary: ScanResults['summary']
  healthGrade: ScanResults['healthGrade']
  healthScore: ScanResults['healthScore']
  languagesDetected: string[]
  rulesEvaluated: number
  scannedFiles: number
  scannedAt: string
}

/**
 * Build a JSON-serializable representation of the current analysis state.
 */
export function buildExportableAnalysis(
  repo: GitHubRepo,
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  scanResults: ScanResults | null,
): ExportableAnalysis {
  return {
    meta: {
      exportedAt: new Date().toISOString(),
      repoFullName: repo.fullName,
      repoUrl: repo.url,
      totalFiles: codeIndex.totalFiles,
      totalLines: codeIndex.totalLines,
      coverage: codeIndex.coverage,
    },
    analysis: analysis ? serializeAnalysis(analysis) : null,
    issues: scanResults ? serializeScanResults(scanResults) : null,
  }
}

function serializeAnalysis(a: FullAnalysis): SerializedFullAnalysis {
  const files: Record<string, unknown> = {}
  for (const [path, fa] of a.files) {
    files[path] = {
      ...fa,
      imports: fa.imports.map(i => ({
        source: i.source,
        resolvedPath: i.resolvedPath,
        specifiers: i.specifiers,
        isExternal: i.isExternal,
        isDefault: i.isDefault,
      })),
    }
  }

  const edges: Record<string, string[]> = {}
  for (const [k, v] of a.graph.edges) {
    edges[k] = Array.from(v)
  }

  const reverseEdges: Record<string, string[]> = {}
  for (const [k, v] of a.graph.reverseEdges) {
    reverseEdges[k] = Array.from(v)
  }

  const externalDeps: Record<string, string[]> = {}
  for (const [k, v] of a.graph.externalDeps) {
    externalDeps[k] = Array.from(v)
  }

  return {
    detectedFramework: a.detectedFramework,
    primaryLanguage: a.primaryLanguage,
    files,
    graph: {
      edges,
      reverseEdges,
      circular: a.graph.circular,
      externalDeps,
    },
    topology: {
      entryPoints: a.topology.entryPoints,
      hubs: a.topology.hubs,
      orphans: a.topology.orphans,
      leafNodes: a.topology.leafNodes,
      connectors: a.topology.connectors,
      clusters: a.topology.clusters,
      maxDepth: a.topology.maxDepth,
    },
  }
}

function serializeScanResults(r: ScanResults): SerializedScanResults {
  return {
    issues: r.issues,
    summary: r.summary,
    healthGrade: r.healthGrade,
    healthScore: r.healthScore,
    languagesDetected: r.languagesDetected,
    rulesEvaluated: r.rulesEvaluated,
    scannedFiles: r.scannedFiles,
    scannedAt: r.scannedAt.toISOString(),
  }
}

/**
 * Serialize analysis data to a formatted JSON string.
 */
export function exportToJson(
  repo: GitHubRepo,
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  scanResults: ScanResults | null,
): string {
  const data = buildExportableAnalysis(repo, codeIndex, analysis, scanResults)
  return JSON.stringify(data, null, 2)
}
