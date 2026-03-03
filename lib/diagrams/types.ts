// Diagram Types — shared type definitions for all diagram generators

export type DiagramType =
  | 'summary'
  | 'topology'
  | 'imports'
  | 'classes'
  | 'entrypoints'
  | 'modules'
  | 'treemap'
  | 'externals'
  | 'focus'

export interface DiagramStats {
  totalNodes: number
  totalEdges: number
  circularDeps?: [string, string][]
  mostImported?: { path: string; count: number }
  mostDependent?: { path: string; count: number }
  avgDepsPerFile?: number
}

export interface MermaidDiagramResult {
  type: DiagramType
  title: string
  chart: string
  stats: DiagramStats
  nodePathMap: Map<string, string>
}

export interface TreemapNode {
  path: string
  name: string
  lines: number
  language?: string
  children?: TreemapNode[]
}

export interface TreemapDiagramResult {
  type: 'treemap'
  title: string
  data: TreemapNode[]
  stats: DiagramStats
}

export interface ProjectSummary {
  languages: { lang: string; files: number; lines: number; pct: number }[]
  topHubs: { path: string; importerCount: number }[]
  topConsumers: { path: string; depCount: number }[]
  circularDeps: [string, string][]
  orphanFiles: string[]
  entryPoints: string[]
  connectors: string[]
  clusterCount: number
  maxDepth: number
  totalFiles: number
  totalLines: number
  frameworkDetected: string | null
  primaryLanguage: string
  healthIssues: string[]
  folderBreakdown: { folder: string; files: number; lines: number; pct: number }[]
  externalDeps: { pkg: string; usedByCount: number }[]
}

export interface SummaryDiagramResult {
  type: 'summary'
  title: string
  data: ProjectSummary
  stats: DiagramStats
}

export type AnyDiagramResult = MermaidDiagramResult | TreemapDiagramResult | SummaryDiagramResult

export interface AvailableDiagram {
  id: DiagramType
  label: string
  available: boolean
  reason?: string
}
