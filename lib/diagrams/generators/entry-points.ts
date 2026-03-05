// Generator — Entry Points / Routes (universal: Next.js, Express, Flask, generic)

import type { CodeIndex } from '@/lib/code/code-index'
import { flattenFiles } from '@/lib/code/code-index'
import type { FullAnalysis } from '@/lib/code/import-parser'
import type { FileNode } from '@/types/repository'
import type { MermaidDiagramResult } from '../types'
import { sanitizeId } from '../helpers'

export function generateEntryPoints(analysis: FullAnalysis, codeIndex: CodeIndex, files: FileNode[]): MermaidDiagramResult {
  const nodePathMap = new Map<string, string>()
  const { topology, detectedFramework, graph } = analysis
  const allFiles = flattenFiles(files)

  let chart = 'flowchart TD\n'
  let nodeCount = 0

  // If Next.js or Nuxt, try framework-specific route detection first
  if (detectedFramework === 'Next.js' || detectedFramework === 'Nuxt') {
    const routeFiles = allFiles.filter(f => {
      const lower = f.path.toLowerCase()
      return (
        lower.match(/app\/.*\/(page|route|layout|loading|error|not-found|template)\.(ts|tsx|js|jsx)$/) ||
        lower.match(/app\/(page|route|layout|loading|error|not-found|template)\.(ts|tsx|js|jsx)$/) ||
        lower.match(/pages\/.*\.(ts|tsx|js|jsx)$/) ||
        lower.match(/middleware\.(ts|tsx|js|jsx)$/)
      )
    })

    if (routeFiles.length > 0) {
      const routeMap = new Map<string, { type: string; path: string; fullPath: string }[]>()
      for (const file of routeFiles) {
        const parts = file.path.split('/')
        const fileName = parts[parts.length - 1]
        const fileType = fileName.replace(/\.(ts|tsx|js|jsx)$/, '')
        let routePath: string
        const appIdx = parts.indexOf('app')
        if (appIdx >= 0) {
          routePath = '/' + parts.slice(appIdx + 1, -1).join('/')
          if (routePath === '/') routePath = '/'
        } else if (parts.indexOf('pages') >= 0) {
          const pIdx = parts.indexOf('pages')
          routePath = '/' + parts.slice(pIdx + 1, -1).join('/')
          if (routePath === '/') routePath = '/'
          if (fileType !== 'index' && fileType !== '_app' && fileType !== '_document') {
            routePath = routePath === '/' ? `/${fileType}` : `${routePath}/${fileType}`
          }
        } else {
          routePath = '/' + file.name
        }
        if (!routeMap.has(routePath)) routeMap.set(routePath, [])
        routeMap.get(routePath)!.push({ type: fileType, path: file.path, fullPath: routePath })
      }

      const styleMap: Record<string, string> = {
        page: ':::pageStyle', route: ':::apiStyle', layout: ':::layoutStyle',
        loading: ':::loadingStyle', error: ':::errorStyle', 'not-found': ':::errorStyle',
        template: ':::layoutStyle', middleware: ':::middlewareStyle',
      }

      const sortedRoutes = Array.from(routeMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      const middlewareFile = allFiles.find(f => /^middleware\.(ts|tsx|js|jsx)$/.test(f.name))
      if (middlewareFile) {
        const id = sanitizeId('middleware')
        chart += `  ${id}["Middleware"]:::middlewareStyle\n`
        nodePathMap.set(id, middlewareFile.path)
        nodeCount++
      }

      const rootId = sanitizeId('root')
      chart += `  ${rootId}["/ (root)"]:::layoutStyle\n`
      nodePathMap.set(rootId, 'app')
      nodeCount++
      if (middlewareFile) chart += `  ${sanitizeId('middleware')} --> ${rootId}\n`

      for (const [routePath, rfs] of sortedRoutes) {
        for (const rf of rfs) {
          const id = sanitizeId(rf.path)
          const label = rf.type === 'page' || rf.type === 'route' ? routePath || '/' : `${routePath || '/'} (${rf.type})`
          chart += `  ${id}["${label}"]${styleMap[rf.type] || ''}\n`
          nodePathMap.set(id, rf.path)
          nodeCount++
          const parentPath = routePath === '/' ? null : routePath.split('/').slice(0, -1).join('/') || '/'
          if (parentPath) {
            const parentFiles = routeMap.get(parentPath)
            if (parentFiles) {
              const parentLayout = parentFiles.find(f => f.type === 'layout') || parentFiles[0]
              if (parentLayout) chart += `  ${sanitizeId(parentLayout.path)} --> ${id}\n`
            } else chart += `  ${rootId} --> ${id}\n`
          } else chart += `  ${rootId} --> ${id}\n`
        }
      }

      chart += '\n  classDef pageStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'
      chart += '  classDef apiStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n'
      chart += '  classDef layoutStyle fill:#8b5cf6,stroke:#a78bfa,color:#fff\n'
      chart += '  classDef loadingStyle fill:#6b7280,stroke:#9ca3af,color:#fff\n'
      chart += '  classDef errorStyle fill:#ef4444,stroke:#f87171,color:#fff\n'
      chart += '  classDef middlewareStyle fill:#10b981,stroke:#34d399,color:#fff\n'

      return {
        type: 'entrypoints',
        title: `Route Tree (${nodeCount} routes)`,
        chart,
        stats: { totalNodes: nodeCount, totalEdges: 0 },
        nodePathMap,
      }
    }
  }

  // Express/Fastify route detection
  if (detectedFramework === 'Express' || detectedFramework === 'Fastify') {
    const routePattern = /\.(get|post|put|delete|patch|all|use)\s*\(\s*['"](\/[^'"]*)['"]/g
    const routeEntries: { method: string; path: string; file: string }[] = []

    for (const [path, fileAnalysis] of analysis.files) {
      const indexed = codeIndex.files.get(path)
      if (!indexed) continue
      let m: RegExpExecArray | null
      routePattern.lastIndex = 0
      while ((m = routePattern.exec(indexed.content)) !== null) {
        routeEntries.push({ method: m[1].toUpperCase(), path: m[2], file: path })
      }
    }

    if (routeEntries.length > 0) {
      chart += `  server["${detectedFramework} Server"]:::entryStyle\n`
      nodeCount++
      for (const entry of routeEntries) {
        const id = sanitizeId(`${entry.method}_${entry.path}_${entry.file}`)
        chart += `  ${id}["${entry.method} ${entry.path}"]:::routeStyle\n`
        chart += `  server --> ${id}\n`
        nodePathMap.set(id, entry.file)
        nodeCount++
      }
      chart += '\n  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
      chart += '  classDef routeStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'

      return {
        type: 'entrypoints',
        title: `${detectedFramework} Routes (${routeEntries.length} routes)`,
        chart,
        stats: { totalNodes: nodeCount, totalEdges: 0 },
        nodePathMap,
      }
    }
  }

  // Flask/FastAPI route detection
  if (detectedFramework === 'Flask' || detectedFramework === 'FastAPI') {
    const pyRoutePattern = /@(?:app|router|bp|blueprint)\.(get|post|put|delete|patch|route)\s*\(\s*['"](\/[^'"]*)['"]/g
    const routeEntries: { method: string; path: string; file: string }[] = []

    for (const [path] of analysis.files) {
      const indexed = codeIndex.files.get(path)
      if (!indexed) continue
      let m: RegExpExecArray | null
      pyRoutePattern.lastIndex = 0
      while ((m = pyRoutePattern.exec(indexed.content)) !== null) {
        routeEntries.push({ method: m[1].toUpperCase(), path: m[2], file: path })
      }
    }

    if (routeEntries.length > 0) {
      chart += `  server["${detectedFramework} App"]:::entryStyle\n`
      nodeCount++
      for (const entry of routeEntries) {
        const id = sanitizeId(`${entry.method}_${entry.path}_${entry.file}`)
        chart += `  ${id}["${entry.method} ${entry.path}"]:::routeStyle\n`
        chart += `  server --> ${id}\n`
        nodePathMap.set(id, entry.file)
        nodeCount++
      }
      chart += '\n  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
      chart += '  classDef routeStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'

      return {
        type: 'entrypoints',
        title: `${detectedFramework} Routes (${routeEntries.length} endpoints)`,
        chart,
        stats: { totalNodes: nodeCount, totalEdges: 0 },
        nodePathMap,
      }
    }
  }

  // Generic fallback: use topology entry points
  if (topology.entryPoints.length === 0) {
    chart += '  empty["No entry points detected"]\n'
    return {
      type: 'entrypoints',
      title: 'Entry Points',
      chart,
      stats: { totalNodes: 0, totalEdges: 0 },
      nodePathMap,
    }
  }

  // Show entry points and their first-level dependencies.
  // Use directory context in labels so multiple "index.ts" files are distinguishable.
  const contextLabel = (p: string): string => {
    const parts = p.split('/')
    if (parts.length <= 1) return p
    // Show parent/filename, e.g. "handlers/index.ts"
    return parts.slice(-2).join('/')
  }

  for (const entry of topology.entryPoints) {
    const id = sanitizeId(entry)
    const name = contextLabel(entry)
    const deps = graph.edges.get(entry)
    chart += `  ${id}["${name}"]:::entryStyle\n`
    nodePathMap.set(id, entry)
    nodeCount++

    if (deps) {
      for (const dep of deps) {
        const depId = sanitizeId(dep)
        const depName = contextLabel(dep)
        if (!nodePathMap.has(depId)) {
          chart += `  ${depId}["${depName}"]:::depStyle\n`
          nodePathMap.set(depId, dep)
          nodeCount++
        }
        chart += `  ${id} --> ${depId}\n`
      }
    }
  }

  chart += '\n  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n'
  chart += '  classDef depStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n'

  return {
    type: 'entrypoints',
    title: `Entry Points (${topology.entryPoints.length} found)`,
    chart,
    stats: { totalNodes: nodeCount, totalEdges: 0 },
    nodePathMap,
  }
}
