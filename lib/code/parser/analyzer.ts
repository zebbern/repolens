// Main analysis entry point — orchestrates all parsing phases.

import type { CodeIndex } from '../code-index'
import { getFileContent } from '../code-index'
import type { FileAnalysis, DependencyGraph, FullAnalysis } from './types'
import { detectLang, detectPrimaryLanguage } from './utils'
import { extractImports } from './languages'
import { extractExports } from './extract-exports'
import { extractTypes, extractClasses, extractJsxComponents } from './extract-types'
import { detectCircularDeps } from './graph'
import { computeTopology } from './topology'
import { detectFramework } from './framework-detection'

const JS_TS_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx'])

export async function analyzeCodebase(codeIndex: CodeIndex): Promise<FullAnalysis> {
  const files = new Map<string, FileAnalysis>()
  const indexedPaths = new Set(codeIndex.files.keys())

  // Phase 1: Analyze each file
  for (const [path] of codeIndex.files) {
    const content = await getFileContent(codeIndex, path)
    if (!content) continue
    const lang = detectLang(path)
    const imports = extractImports(content, path, lang, indexedPaths)
    const exports = extractExports(content, lang)
    const types = extractTypes(content, lang)
    const classes = extractClasses(content, lang)
    const jsxComponents = extractJsxComponents(content, lang)

    files.set(path, { path, imports, exports, types, classes, jsxComponents, language: lang })
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

/**
 * Async variant of `analyzeCodebase` — enhances non-JS/TS files with
 * Tree-sitter–based type and class extraction for richer class diagrams.
 */
export async function analyzeCodebaseAsync(codeIndex: CodeIndex): Promise<FullAnalysis> {
  const result = await analyzeCodebase(codeIndex)

  const { extractTypesAsync, extractClassesAsync } = await import('./extract-types')

  const enhancePromises: Promise<void>[] = []
  for (const [path, fileAnalysis] of result.files) {
    if (JS_TS_LANGS.has(fileAnalysis.language)) continue

    enhancePromises.push((async () => {
      const content = await getFileContent(codeIndex, path) ?? ''
      const [asyncTypes, asyncClasses] = await Promise.all([
        extractTypesAsync(content, fileAnalysis.language),
        extractClassesAsync(content, fileAnalysis.language),
      ])
      if (asyncTypes.length > fileAnalysis.types.length) {
        fileAnalysis.types = asyncTypes
      }
      if (asyncClasses.length > fileAnalysis.classes.length) {
        fileAnalysis.classes = asyncClasses
      }
    })())
  }

  await Promise.all(enhancePromises)
  return result
}
