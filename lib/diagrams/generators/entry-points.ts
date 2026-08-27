// Generator — Entry Points / Routes (universal: Next.js, Express, Flask, generic)

import type { CodeIndex } from '@/lib/code/code-index'
import { flattenFiles, getFileContent } from '@/lib/code/code-index'
import type { FullAnalysis } from '@/lib/code/import-parser'
import type { FileNode } from '@/types/repository'
import type { MermaidDiagramResult } from '../types'
import { sanitizeId, escapeMermaidLabel, MERMAID_EDGE_BUDGET, MERMAID_SOURCE_BUDGET } from '../helpers'

interface BoundedFlowNode {
  id: string
  label: string
  style?: string
  path?: string
}

interface BoundedFlowEdge {
  from: string
  to: string
}

function renderBoundedFlowchart(
  permanentNodes: BoundedFlowNode[],
  candidateNodes: BoundedFlowNode[],
  edges: BoundedFlowEdge[],
  footer: string,
): { chart: string; nodes: BoundedFlowNode[]; totalEdges: number; omittedNodes: number; omittedEdges: number } {
  const uniquePermanentNodes = [...new Map(permanentNodes.map(node => [node.id, node])).values()]
  const permanentIds = new Set(uniquePermanentNodes.map(node => node.id))
  const uniqueCandidateNodes = [...new Map(candidateNodes.map(node => [node.id, node])).values()]
    .filter(node => !permanentIds.has(node.id))
  const uniqueEdges = [...new Map(edges.map(edge => [`${edge.from}-->${edge.to}`, edge])).values()]
  const render = (candidateCount: number) => {
    const nodes = uniqueCandidateNodes.slice(0, candidateCount)
    const renderedIds = new Set([...permanentIds, ...nodes.map(node => node.id)])
    const renderedEdges = uniqueEdges.filter(edge => renderedIds.has(edge.from) && renderedIds.has(edge.to)).slice(0, MERMAID_EDGE_BUDGET)
    let chart = 'flowchart TD\n'
    for (const node of [...uniquePermanentNodes, ...nodes]) {
      const label = node.label.length > 120 ? `${node.label.slice(0, 117)}...` : node.label
      chart += `  ${node.id}["${escapeMermaidLabel(label)}"]${node.style ? `:::${node.style}` : ''}\n`
    }
    for (const edge of renderedEdges) chart += `  ${edge.from} --> ${edge.to}\n`
    const omittedNodes = uniqueCandidateNodes.length - nodes.length
    const omittedEdges = uniqueEdges.length - renderedEdges.length
    if (omittedNodes > 0 || omittedEdges > 0) chart += `  %% ${omittedNodes} nodes and ${omittedEdges} edges omitted\n`
    chart += footer
    return { chart, nodes, totalEdges: renderedEdges.length, omittedNodes, omittedEdges }
  }

  let low = 0
  let high = uniqueCandidateNodes.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (render(mid).chart.length <= MERMAID_SOURCE_BUDGET) low = mid
    else high = mid - 1
  }
  return render(low)
}

function routeNodeId(method: string, routePath: string, file: string): string {
  const encoded = `route:${method.length}:${method}:${routePath.length}:${routePath}:${file.length}:${file}`
  return sanitizeId(encoded)
}

export async function generateEntryPoints(analysis: FullAnalysis, codeIndex: CodeIndex, files: FileNode[]): Promise<MermaidDiagramResult> {
  const nodePathMap = new Map<string, string>()
  const { topology, detectedFramework, graph } = analysis
  const allFiles = flattenFiles(files)

  let chart = 'flowchart TD\n'
  let nodeCount = 0
  let edgeCount = 0

  // If Next.js or Nuxt, try framework-specific route detection first
  if (detectedFramework === 'Next.js' || detectedFramework === 'Nuxt') {
    const isNuxt = detectedFramework === 'Nuxt'
    const routeFiles = allFiles.filter(f => {
      const lower = f.path.toLowerCase()
      if (isNuxt) return /(?:^|\/)pages\/.*\.vue$/.test(lower)
      return Boolean(
        lower.match(/(?:^|\/)app\/.*\/(page|route|layout|loading|error|not-found|template)\.(ts|tsx|js|jsx)$/) ||
        lower.match(/(?:^|\/)app\/(page|route|layout|loading|error|not-found|template)\.(ts|tsx|js|jsx)$/) ||
        lower.match(/(?:^|\/)pages\/.*\.(ts|tsx|js|jsx)$/)
      )
    })

    if (routeFiles.length > 0) {
      const routeMap = new Map<string, { type: string; path: string; fullPath: string }[]>()
      for (const file of routeFiles) {
        const parts = file.path.split('/')
        const fileName = parts[parts.length - 1]
        const fileType = fileName.replace(/\.(ts|tsx|js|jsx|vue)$/, '')
        let routePath: string
        const appIdx = parts.indexOf('app')
        const pagesIdx = parts.indexOf('pages')
        if (isNuxt && pagesIdx >= 0) {
          routePath = '/' + parts.slice(pagesIdx + 1, -1).join('/')
          if (fileType !== 'index') routePath = routePath === '/' ? `/${fileType}` : `${routePath}/${fileType}`
        } else if (appIdx >= 0) {
          routePath = '/' + parts.slice(appIdx + 1, -1).join('/')
        } else if (pagesIdx >= 0) {
          const pIdx = pagesIdx
          routePath = '/' + parts.slice(pIdx + 1, -1).join('/')
          if (fileType !== 'index' && fileType !== '_app' && fileType !== '_document') {
            routePath = routePath === '/' ? `/${fileType}` : `${routePath}/${fileType}`
          }
        } else {
          routePath = '/' + file.name
        }
        if (!routeMap.has(routePath)) routeMap.set(routePath, [])
        const routeType = detectedFramework === 'Nuxt' && parts.includes('pages')
          ? 'page'
          : fileType === 'index' ? 'page' : fileType
        routeMap.get(routePath)!.push({ type: routeType, path: file.path, fullPath: routePath })
      }

      const styleMap: Record<string, string> = {
        page: ':::pageStyle', route: ':::apiStyle', layout: ':::layoutStyle',
        loading: ':::loadingStyle', error: ':::errorStyle', 'not-found': ':::errorStyle',
        template: ':::layoutStyle', middleware: ':::middlewareStyle',
      }

      const sortedRoutes = Array.from(routeMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      const routeCandidates = sortedRoutes.flatMap(([routePath, rfs]) => rfs.map(rf => ({ ...rf, routePath })))
      const middlewareFile = allFiles.find(f => /^middleware\.(ts|tsx|js|jsx|vue)$/.test(f.name))
      const rootId = sanitizeId('root')
      const middlewareId = sanitizeId('middleware')
      const permanentNodes: BoundedFlowNode[] = [
        ...(middlewareFile ? [{ id: middlewareId, label: 'Middleware', style: 'middlewareStyle', path: middlewareFile.path }] : []),
        { id: rootId, label: '/ (root)', style: 'layoutStyle', path: isNuxt ? 'pages' : 'app' },
      ]
      const routeNodes: BoundedFlowNode[] = routeCandidates.map(rf => {
        const label = rf.type === 'page' || rf.type === 'route' ? rf.routePath || '/' : `${rf.routePath || '/'} (${rf.type})`
        return { id: routeNodeId(rf.type, rf.routePath, rf.path), label, style: styleMap[rf.type]?.slice(3), path: rf.path }
      })
      const routeIds = new Set(routeCandidates.map(rf => rf.path))
      const routeEdges: BoundedFlowEdge[] = []
      if (middlewareFile) routeEdges.push({ from: middlewareId, to: rootId })
      for (const rf of routeCandidates) {
        const parentPath = rf.routePath === '/' ? null : rf.routePath.split('/').slice(0, -1).join('/') || '/'
        const parentFiles = parentPath ? routeMap.get(parentPath) : undefined
        const parentLayout = parentFiles?.find(f => f.type === 'layout') || parentFiles?.[0]
        routeEdges.push({ from: parentLayout && routeIds.has(parentLayout.path) ? routeNodeId(parentLayout.type, parentLayout.fullPath, parentLayout.path) : rootId, to: routeNodeId(rf.type, rf.routePath, rf.path) })
      }
      const footer = '\n  classDef pageStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n' +
        '  classDef apiStyle fill:#f59e0b,stroke:#fbbf24,color:#000\n' +
        '  classDef layoutStyle fill:#8b5cf6,stroke:#a78bfa,color:#fff\n' +
        '  classDef loadingStyle fill:#6b7280,stroke:#9ca3af,color:#fff\n' +
        '  classDef errorStyle fill:#ef4444,stroke:#f87171,color:#fff\n' +
        '  classDef middlewareStyle fill:#10b981,stroke:#34d399,color:#000\n'
      const rendered = renderBoundedFlowchart(permanentNodes, routeNodes, routeEdges, footer)
      chart = rendered.chart
      nodeCount = permanentNodes.length + rendered.nodes.length
      edgeCount = rendered.totalEdges
      for (const node of rendered.nodes) if (node.path) nodePathMap.set(node.id, node.path)
      for (const node of permanentNodes) if (node.path) nodePathMap.set(node.id, node.path)
      return {
        type: 'entrypoints',
        title: `Route Tree (${rendered.nodes.length} routes)`,
        chart,
        stats: { totalNodes: nodeCount, totalEdges: edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges },
        nodePathMap,
      }
    }
  }

  // Express/Fastify route detection
  if (detectedFramework === 'Express' || detectedFramework === 'Fastify') {
    const routePattern = /\.(get|post|put|delete|patch|all|use)\s*\(\s*['"](\/[^'"]*)['"]/g
    const routeEntries: { method: string; path: string; file: string }[] = []

    for (const [path] of analysis.files) {
      const content = await getFileContent(codeIndex, path)
      if (content === null) continue
      let m: RegExpExecArray | null
      routePattern.lastIndex = 0
      while ((m = routePattern.exec(content)) !== null) {
        routeEntries.push({ method: m[1].toUpperCase(), path: m[2], file: path })
      }
    }

    if (routeEntries.length > 0) {
      const routeNodes: BoundedFlowNode[] = routeEntries.map(entry => ({
        id: routeNodeId(entry.method, entry.path, entry.file), label: `${entry.method} ${entry.path}`, style: 'routeStyle', path: entry.file,
      }))
      const routeEdges = routeNodes.map(node => ({ from: 'server', to: node.id }))
      const rendered = renderBoundedFlowchart(
        [{ id: 'server', label: `${detectedFramework} Server`, style: 'entryStyle' }], routeNodes, routeEdges,
        '\n  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n  classDef routeStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n',
      )
      chart = rendered.chart
      nodeCount = rendered.nodes.length + 1
      edgeCount = rendered.totalEdges
      for (const node of rendered.nodes) if (node.path) nodePathMap.set(node.id, node.path)
      return {
        type: 'entrypoints',
        title: `${detectedFramework} Routes (${rendered.nodes.length} routes)`,
        chart,
        stats: { totalNodes: nodeCount, totalEdges: edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges },
        nodePathMap,
      }
    }
  }

  // Flask/FastAPI route detection
  if (detectedFramework === 'Flask' || detectedFramework === 'FastAPI') {
    const pyRoutePattern = /@(?:app|router|bp|blueprint)\.(get|post|put|delete|patch|route)\s*\(\s*['"](\/[^'"]*)['"]/g
    const routeEntries: { method: string; path: string; file: string }[] = []

    for (const [path] of analysis.files) {
      const content = await getFileContent(codeIndex, path)
      if (content === null) continue
      let m: RegExpExecArray | null
      pyRoutePattern.lastIndex = 0
      while ((m = pyRoutePattern.exec(content)) !== null) {
        routeEntries.push({ method: m[1].toUpperCase(), path: m[2], file: path })
      }
    }

    if (routeEntries.length > 0) {
      const routeNodes: BoundedFlowNode[] = routeEntries.map(entry => ({
        id: routeNodeId(entry.method, entry.path, entry.file), label: `${entry.method} ${entry.path}`, style: 'routeStyle', path: entry.file,
      }))
      const routeEdges = routeNodes.map(node => ({ from: 'server', to: node.id }))
      const rendered = renderBoundedFlowchart(
        [{ id: 'server', label: `${detectedFramework} App`, style: 'entryStyle' }], routeNodes, routeEdges,
        '\n  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n  classDef routeStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n',
      )
      chart = rendered.chart
      nodeCount = rendered.nodes.length + 1
      edgeCount = rendered.totalEdges
      for (const node of rendered.nodes) if (node.path) nodePathMap.set(node.id, node.path)
      return {
        type: 'entrypoints',
        title: `${detectedFramework} Routes (${rendered.nodes.length} endpoints)`,
        chart,
        stats: { totalNodes: nodeCount, totalEdges: edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges },
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

  // Virtual root node connects all entry points so the graph stays connected
  // and Mermaid renders vertically instead of as a flat horizontal line.
  const contextLabel = (p: string): string => {
    const parts = p.split('/')
    if (parts.length <= 1) return p
    return parts.slice(-2).join('/')
  }

  const candidateMap = new Map<string, BoundedFlowNode>()
  const candidateEdges: BoundedFlowEdge[] = []

  const addNode = (path: string, style: string): string => {
    const id = sanitizeId(path)
    if (!candidateMap.has(id)) candidateMap.set(id, { id, label: contextLabel(path), style, path })
    return id
  }

  const addEdge = (fromId: string, toId: string): void => {
    candidateEdges.push({ from: fromId, to: toId })
  }

  for (const entry of topology.entryPoints) {
    const entryId = addNode(entry, 'entryStyle')
    addEdge('root', entryId)

    // Depth 1: direct dependencies
    const deps = graph.edges.get(entry)
    if (deps) {
      for (const dep of deps) {
        const depId = addNode(dep, 'depStyle')
        addEdge(entryId, depId)

        // Depth 2: transitive dependencies
        const subDeps = graph.edges.get(dep)
        if (subDeps) {
          for (const subDep of subDeps) {
            const subDepId = addNode(subDep, 'depStyle')
            addEdge(depId, subDepId)
          }
        }
      }
    }
  }

  const rendered = renderBoundedFlowchart(
    [{ id: 'root', label: 'Application', style: 'rootStyle', path: 'root' }], [...candidateMap.values()], candidateEdges,
    '\n  style root fill:#4a5568,stroke:#2d3748,color:#fff\n  classDef rootStyle fill:#4a5568,stroke:#2d3748,color:#fff\n  classDef entryStyle fill:#22c55e,stroke:#4ade80,color:#000\n  classDef depStyle fill:#3b82f6,stroke:#60a5fa,color:#fff\n',
  )
  chart = rendered.chart
  nodeCount = rendered.nodes.length + 1
  edgeCount = rendered.totalEdges
  nodePathMap.set('root', 'root')
  for (const node of rendered.nodes) if (node.path) nodePathMap.set(node.id, node.path)

  return {
    type: 'entrypoints',
    title: `Entry Points (${topology.entryPoints.length} found)`,
    chart,
    stats: { totalNodes: nodeCount, totalEdges: edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges },
    nodePathMap,
  }
}
