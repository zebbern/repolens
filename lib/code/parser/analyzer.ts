// Main analysis entry point — orchestrates all parsing phases.

import type { CodeIndex } from '../code-index'
import { resolveFileContentBatches } from '../code-index'
import type { FileAnalysis, DependencyGraph, FullAnalysis } from './types'
import { detectLang, detectPrimaryLanguage } from './utils'
import { extractImports } from './languages'
import { extractExports } from './extract-exports'
import { extractTypes, extractClasses, extractJsxComponents } from './extract-types'
import { detectCircularDeps } from './graph'
import { computeTopology } from './topology'
import { detectFramework } from './framework-detection'

const JS_TS_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx'])

async function analyzeCodebaseInternal(codeIndex: CodeIndex, enhanceNonJs: boolean): Promise<FullAnalysis> {
  const files = new Map<string, FileAnalysis>()
  const indexedPaths = new Set(codeIndex.files.keys())
  const missingPaths: string[] = []
  const asyncExtractors = enhanceNonJs ? await import('./extract-types') : null

  // Analyze bounded source batches and retain only structural metadata. Source
  // strings from an IDB-backed repository become collectible after each batch.
  for await (const batch of resolveFileContentBatches(codeIndex, [...codeIndex.files.keys()])) {
    missingPaths.push(...batch.missingPaths)
    for (const path of batch.paths) {
      const content = batch.contents.get(path)
      if (content === undefined) continue
      const lang = detectLang(path)
      const imports = extractImports(content, path, lang, indexedPaths)
      const exports = extractExports(content, lang)
      let types = extractTypes(content, lang)
      let classes = extractClasses(content, lang)
      const jsxComponents = extractJsxComponents(content, lang)

      if (asyncExtractors && !JS_TS_LANGS.has(lang)) {
        const [asyncTypes, asyncClasses] = await Promise.all([
          asyncExtractors.extractTypesAsync(content, lang),
          asyncExtractors.extractClassesAsync(content, lang),
        ])
        if (asyncTypes.length > types.length) types = asyncTypes
        if (asyncClasses.length > classes.length) classes = asyncClasses
      }

      files.set(path, { path, imports, exports, types, classes, jsxComponents, language: lang })
    }
  }

  if (missingPaths.length > 0) {
    throw new Error(`Content unavailable for indexed files: ${missingPaths.join(', ')}`)
  }

  // Phase 2: Build dependency graph
  const edges = new Map<string, Set<string>>()
  const reverseEdges = new Map<string, Set<string>>()
  const externalDeps = new Map<string, Set<string>>()

  for (const [path, analysis] of files) {
    if (!edges.has(path)) edges.set(path, new Set())
    for (const imp of analysis.imports) {
      if (imp.isExternal) {
        const pkgName = imp.source.startsWith('@')
          ? imp.source.split('/').slice(0, 2).join('/')
          : imp.source.split('/')[0]
        if (!externalDeps.has(pkgName)) externalDeps.set(pkgName, new Set())
        externalDeps.get(pkgName)!.add(path)
      } else if (imp.resolvedPath) {
        edges.get(path)!.add(imp.resolvedPath)
        if (!reverseEdges.has(imp.resolvedPath)) reverseEdges.set(imp.resolvedPath, new Set())
        reverseEdges.get(imp.resolvedPath)!.add(path)
      }
    }
  }

  // Phase 3: Detect circular deps
  const circular = detectCircularDeps(edges)
  const graph: DependencyGraph = { edges, reverseEdges, circular, externalDeps }

  // Phase 4: Topology
  const allPaths = Array.from(files.keys())
  const topology = computeTopology(graph, allPaths)

  // Phase 5: Framework detection
  const detectedFramework = detectFramework(files, graph)
  const primaryLanguage = detectPrimaryLanguage(files)

  return { files, graph, topology, detectedFramework, primaryLanguage }
}

export async function analyzeCodebase(codeIndex: CodeIndex): Promise<FullAnalysis> {
  return analyzeCodebaseInternal(codeIndex, false)
}

/**
 * Async variant of `analyzeCodebase` — enhances non-JS/TS files with
 * Tree-sitter–based type and class extraction for richer class diagrams.
 */
export async function analyzeCodebaseAsync(codeIndex: CodeIndex): Promise<FullAnalysis> {
  return analyzeCodebaseInternal(codeIndex, true)
}
