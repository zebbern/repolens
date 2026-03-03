// Parser types — all shared type/interface definitions for the code analysis engine.

export interface ResolvedImport {
  source: string
  resolvedPath: string | null
  specifiers: string[]
  isExternal: boolean
  isDefault: boolean
}

export interface ExportInfo {
  name: string
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'component' | 'unknown'
  isDefault: boolean
}

export interface ExtractedType {
  name: string
  kind: 'interface' | 'type' | 'enum'
  properties: string[]
  extends?: string[]
  exported: boolean
}

export interface ExtractedClass {
  name: string
  methods: string[]
  properties: string[]
  extends?: string
  implements?: string[]
  exported: boolean
}

export interface FileAnalysis {
  path: string
  imports: ResolvedImport[]
  exports: ExportInfo[]
  types: ExtractedType[]
  classes: ExtractedClass[]
  jsxComponents: string[]
  language: string
}

export interface DependencyGraph {
  edges: Map<string, Set<string>>
  reverseEdges: Map<string, Set<string>>
  circular: [string, string][]
  externalDeps: Map<string, Set<string>>
}

export interface TopologyAnalysis {
  entryPoints: string[]
  hubs: string[]
  orphans: string[]
  leafNodes: string[]
  connectors: string[]
  clusters: string[][]
  depthMap: Map<string, number>
  maxDepth: number
}

export interface FullAnalysis {
  files: Map<string, FileAnalysis>
  graph: DependencyGraph
  topology: TopologyAnalysis
  detectedFramework: string | null
  primaryLanguage: string
}
