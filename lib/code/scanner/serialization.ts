// Serialization helpers for transferring scanner data across the Web Worker boundary.
// Maps and Sets are converted to entry arrays; Date to ISO string.

import type { CodeIndex, IndexedFile } from '../code-index'
import { InMemoryContentStore } from '../content-store'
import type { FullAnalysis, FileAnalysis, DependencyGraph, TopologyAnalysis } from '../parser/types'
import type { ScanResults } from './types'

// ---------------------------------------------------------------------------
// Serializable mirror types
// ---------------------------------------------------------------------------

export interface SerializedCodeIndex {
  files: [string, IndexedFile][]
  totalFiles: number
  totalLines: number
  isIndexing: boolean
}

export interface SerializedDependencyGraph {
  edges: [string, string[]][]
  reverseEdges: [string, string[]][]
  circular: [string, string][]
  externalDeps: [string, string[]][]
}

export interface SerializedTopologyAnalysis {
  entryPoints: string[]
  hubs: string[]
  orphans: string[]
  leafNodes: string[]
  connectors: string[]
  clusters: string[][]
  depthMap: [string, number][]
  maxDepth: number
}

export interface SerializedFullAnalysis {
  files: [string, FileAnalysis][]
  graph: SerializedDependencyGraph
  topology: SerializedTopologyAnalysis
  detectedFramework: string | null
  primaryLanguage: string
}

export type SerializedScanResults = Omit<ScanResults, 'ruleOverflow' | 'scannedAt'> & {
  ruleOverflow: [string, number][]
  scannedAt: string
}

// ---------------------------------------------------------------------------
// Worker message types
// ---------------------------------------------------------------------------

export interface ScanWorkerRequest {
  id: number
  codeIndex: SerializedCodeIndex
  analysis: SerializedFullAnalysis | null
  changedFiles?: string[]
  /** When set, worker loads content from IDB instead of using serialized content. */
  repoKey?: string
}

export type ScanWorkerResponse =
  | { type: 'result'; id: number; results: SerializedScanResults }
  | { type: 'error'; id: number; error: string }

// ---------------------------------------------------------------------------
// CodeIndex
// ---------------------------------------------------------------------------

export function serializeCodeIndex(index: CodeIndex): SerializedCodeIndex {
  return {
    files: Array.from(index.files.entries()),
    totalFiles: index.totalFiles,
    totalLines: index.totalLines,
    isIndexing: index.isIndexing,
  }
}

/** Serialize CodeIndex with empty content — for workers that load content from IDB. */
export function serializeCodeIndexMeta(index: CodeIndex): SerializedCodeIndex {
  return {
    files: Array.from(index.files.entries()).map(([path, file]) => [
      path,
      { ...file, content: '' },
    ]),
    totalFiles: index.totalFiles,
    totalLines: index.totalLines,
    isIndexing: index.isIndexing,
  }
}

export function deserializeCodeIndex(data: SerializedCodeIndex): CodeIndex {
  return {
    files: new Map(data.files),
    totalFiles: data.totalFiles,
    totalLines: data.totalLines,
    isIndexing: data.isIndexing,
    meta: new Map(),
    contentStore: new InMemoryContentStore(),
  }
}

// ---------------------------------------------------------------------------
// FullAnalysis
// ---------------------------------------------------------------------------

function serializeMapOfSets(map: Map<string, Set<string>>): [string, string[]][] {
  return Array.from(map.entries()).map(([k, v]) => [k, Array.from(v)])
}

function deserializeMapOfSets(entries: [string, string[]][]): Map<string, Set<string>> {
  return new Map(entries.map(([k, v]) => [k, new Set(v)]))
}

export function serializeFullAnalysis(analysis: FullAnalysis): SerializedFullAnalysis {
  return {
    files: Array.from(analysis.files.entries()),
    graph: {
      edges: serializeMapOfSets(analysis.graph.edges),
      reverseEdges: serializeMapOfSets(analysis.graph.reverseEdges),
      circular: analysis.graph.circular,
      externalDeps: serializeMapOfSets(analysis.graph.externalDeps),
    },
    topology: {
      entryPoints: analysis.topology.entryPoints,
      hubs: analysis.topology.hubs,
      orphans: analysis.topology.orphans,
      leafNodes: analysis.topology.leafNodes,
      connectors: analysis.topology.connectors,
      clusters: analysis.topology.clusters,
      depthMap: Array.from(analysis.topology.depthMap.entries()),
      maxDepth: analysis.topology.maxDepth,
    },
    detectedFramework: analysis.detectedFramework,
    primaryLanguage: analysis.primaryLanguage,
  }
}

export function deserializeFullAnalysis(data: SerializedFullAnalysis): FullAnalysis {
  return {
    files: new Map(data.files),
    graph: {
      edges: deserializeMapOfSets(data.graph.edges),
      reverseEdges: deserializeMapOfSets(data.graph.reverseEdges),
      circular: data.graph.circular,
      externalDeps: deserializeMapOfSets(data.graph.externalDeps),
    },
    topology: {
      entryPoints: data.topology.entryPoints,
      hubs: data.topology.hubs,
      orphans: data.topology.orphans,
      leafNodes: data.topology.leafNodes,
      connectors: data.topology.connectors,
      clusters: data.topology.clusters,
      depthMap: new Map(data.topology.depthMap),
      maxDepth: data.topology.maxDepth,
    },
    detectedFramework: data.detectedFramework,
    primaryLanguage: data.primaryLanguage,
  }
}

// ---------------------------------------------------------------------------
// ScanResults
// ---------------------------------------------------------------------------

export function serializeScanResults(results: ScanResults): SerializedScanResults {
  return {
    ...results,
    ruleOverflow: Array.from(results.ruleOverflow.entries()),
    scannedAt: results.scannedAt.toISOString(),
  }
}

export function deserializeScanResults(data: SerializedScanResults): ScanResults {
  return {
    ...data,
    ruleOverflow: new Map(data.ruleOverflow),
    scannedAt: new Date(data.scannedAt),
  }
}
