// Generator — Project Summary (data object, not Mermaid)

import type { CodeIndex } from '@/lib/code/code-index'
import type { FullAnalysis } from '@/lib/code/import-parser'
import type { DiagramStats, SummaryDiagramResult, ProjectSummary } from '../types'
import { computeCommonStats } from '../helpers'

export function generateProjectSummary(analysis: FullAnalysis, codeIndex: CodeIndex): SummaryDiagramResult {
  const { graph, topology, files } = analysis
  const commonStats = computeCommonStats(analysis)

  // Language breakdown
  const langCounts = new Map<string, { files: number; lines: number }>()
  for (const [path, fileAnalysis] of files) {
    const lang = fileAnalysis.language || 'unknown'
    const indexed = codeIndex.files.get(path)
    const lines = indexed?.lineCount || 0
    const existing = langCounts.get(lang) || { files: 0, lines: 0 }
    langCounts.set(lang, { files: existing.files + 1, lines: existing.lines + lines })
  }
  const totalLines = codeIndex.totalLines
  const languages = Array.from(langCounts.entries())
    .map(([lang, { files, lines }]) => ({ lang, files, lines, pct: totalLines > 0 ? Math.round((lines / totalLines) * 1000) / 10 : 0 }))
    .sort((a, b) => b.lines - a.lines)

  // Top hubs (most imported)
  const topHubs = topology.hubs
    .map(path => ({ path, importerCount: graph.reverseEdges.get(path)?.size || 0 }))
    .sort((a, b) => b.importerCount - a.importerCount)
    .slice(0, 10)

  // Top consumers (most outgoing deps)
  const topConsumers = Array.from(graph.edges.entries())
    .map(([path, deps]) => ({ path, depCount: deps.size }))
    .sort((a, b) => b.depCount - a.depCount)
    .slice(0, 10)

  // Folder breakdown — adaptive depth
  // If top-level gives <3 meaningful folders, go one level deeper
  function computeFolderBreakdown(depth: number): Map<string, { files: number; lines: number }> {
    const counts = new Map<string, { files: number; lines: number }>()
    for (const [path] of files) {
      const parts = path.split('/')
      const folder = parts.length > depth ? parts.slice(0, depth).join('/') : '(root)'
      const indexed = codeIndex.files.get(path)
      const lines = indexed?.lineCount || 0
      const existing = counts.get(folder) || { files: 0, lines: 0 }
      counts.set(folder, { files: existing.files + 1, lines: existing.lines + lines })
    }
    return counts
  }

  let folderCounts = computeFolderBreakdown(1)
  // If top-level has very few folders (e.g. everything in src/), go deeper
  const meaningfulFolders = Array.from(folderCounts.entries()).filter(([, v]) => v.files > 1)
  if (meaningfulFolders.length < 3 && files.size > 10) {
    folderCounts = computeFolderBreakdown(2)
  }

  const folderBreakdown = Array.from(folderCounts.entries())
    .filter(([f]) => f !== '(root)' || folderCounts.size === 1)
    .map(([folder, { files: fCount, lines }]) => ({
      folder,
      files: fCount,
      lines,
      pct: totalLines > 0 ? Math.round((lines / totalLines) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 12)

  // External dependencies — packages used by most files
  const externalDeps = Array.from(graph.externalDeps.entries())
    .map(([pkg, importers]) => ({ pkg, usedByCount: importers.size }))
    .sort((a, b) => b.usedByCount - a.usedByCount)
    .slice(0, 25)

  // Health issues
  const healthIssues: string[] = []
  if (graph.circular.length > 0) healthIssues.push(`${graph.circular.length} circular dependency pair${graph.circular.length > 1 ? 's' : ''} detected`)
  if (topology.orphans.length > 5) healthIssues.push(`${topology.orphans.length} orphan files (never imported, never import) may be dead code`)
  if (topology.maxDepth > 8) healthIssues.push(`Deepest dependency chain is ${topology.maxDepth} levels — consider flattening`)
  const highCoupling = topHubs.filter(h => h.importerCount > Math.max(10, files.size * 0.3))
  if (highCoupling.length > 0) healthIssues.push(`${highCoupling.length} file${highCoupling.length > 1 ? 's' : ''} imported by >30% of the project (high coupling risk)`)
  if (topology.connectors.length > 0) healthIssues.push(`${topology.connectors.length} connector file${topology.connectors.length > 1 ? 's' : ''} — removing any would split the dependency graph`)

  const data: ProjectSummary = {
    languages,
    topHubs,
    topConsumers,
    circularDeps: graph.circular,
    orphanFiles: topology.orphans,
    entryPoints: topology.entryPoints,
    connectors: topology.connectors,
    clusterCount: topology.clusters.length,
    maxDepth: topology.maxDepth,
    totalFiles: files.size,
    totalLines,
    frameworkDetected: analysis.detectedFramework,
    primaryLanguage: analysis.primaryLanguage,
    healthIssues,
    folderBreakdown,
    externalDeps,
  }

  return {
    type: 'summary',
    title: 'Project Summary',
    data,
    stats: { totalNodes: files.size, ...commonStats } as DiagramStats,
  }
}
