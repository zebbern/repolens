// Generator — Class / Type Diagram (works with Go structs, Rust structs/enums, Python classes)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult } from '../types'

export function generateClassDiagram(analysis: FullAnalysis): MermaidDiagramResult {
  const nodePathMap = new Map<string, string>()

  // Sanitize a name so it's valid as a Mermaid class identifier
  const sanitizeName = (n: string) => n.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Unknown'
  // Sanitize property/method text for display inside a class block
  const sanitizeProp = (p: string) => p.replace(/[{}()<>|~"`;:*#]/g, ' ').replace(/\s+/g, ' ').trim()

  // First pass: collect ALL types/classes and score them by importance
  type TypeEntry = {
    safeName: string
    path: string
    kind: 'interface' | 'enum' | 'type' | 'class'
    properties: string[]
    methods?: string[]
    extends?: string[]
    implements?: string[]
    exported: boolean
    hasRelationship: boolean // has extends/implements
    propCount: number
  }
  const allTypes: TypeEntry[] = []
  const seenNames = new Set<string>()

  for (const [path, fileAnalysis] of analysis.files) {
    for (const t of fileAnalysis.types) {
      if (!t.exported && t.properties.length === 0) continue
      const safeName = sanitizeName(t.name)
      if (seenNames.has(safeName)) continue
      seenNames.add(safeName)
      const hasRel = !!(t.extends && t.extends.length > 0)
      allTypes.push({
        safeName, path, kind: t.kind as 'interface' | 'enum' | 'type',
        properties: t.properties, exported: t.exported, hasRelationship: hasRel,
        propCount: t.properties.length, extends: t.extends,
      })
    }
    for (const cls of fileAnalysis.classes) {
      const safeName = sanitizeName(cls.name)
      if (seenNames.has(safeName)) continue
      seenNames.add(safeName)
      const hasRel = !!(cls.extends || (cls.implements && cls.implements.length > 0))
      allTypes.push({
        safeName, path, kind: 'class',
        properties: cls.properties, methods: cls.methods, exported: true,
        hasRelationship: hasRel, propCount: cls.properties.length + cls.methods.length,
        extends: cls.extends ? [cls.extends] : undefined, implements: cls.implements,
      })
    }
  }

  const totalFound = allTypes.length

  // Score and sort: prioritize types with relationships, then classes, then exported with many props
  allTypes.sort((a, b) => {
    // Types with inheritance/implementation first
    if (a.hasRelationship !== b.hasRelationship) return a.hasRelationship ? -1 : 1
    // Classes before interfaces before types
    const kindOrder = { class: 0, interface: 1, enum: 2, type: 3 }
    if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind]
    // More properties = more important
    return b.propCount - a.propCount
  })

  // Limit to 40 types max to prevent Mermaid from creating an impossibly wide diagram
  const MAX_TYPES = 40
  const typesToRender = allTypes.slice(0, MAX_TYPES)

  // Also include any parent types referenced by extends/implements even if they weren't in the top N
  const renderedNames = new Set(typesToRender.map(t => t.safeName))
  for (const t of typesToRender) {
    if (t.extends) for (const ext of t.extends) {
      const safeExt = sanitizeName(ext.trim())
      if (!renderedNames.has(safeExt)) {
        const parent = allTypes.find(a => a.safeName === safeExt)
        if (parent) { typesToRender.push(parent); renderedNames.add(safeExt) }
      }
    }
    if (t.implements) for (const impl of t.implements) {
      const safeImpl = sanitizeName(impl.trim())
      if (!renderedNames.has(safeImpl)) {
        const parent = allTypes.find(a => a.safeName === safeImpl)
        if (parent) { typesToRender.push(parent); renderedNames.add(safeImpl) }
      }
    }
  }

  let chart = 'classDiagram\n'
  let nodeCount = 0
  let edgeCount = 0

  for (const t of typesToRender) {
    nodePathMap.set(t.safeName, t.path)
    nodeCount++
    if (t.kind === 'interface') {
      chart += `  class ${t.safeName} {\n    <<interface>>\n`
      for (const prop of t.properties.slice(0, 8)) {
        const s = sanitizeProp(prop)
        if (s) chart += `    +${s}\n`
      }
      chart += `  }\n`
    } else if (t.kind === 'enum') {
      chart += `  class ${t.safeName} {\n    <<enumeration>>\n`
      for (const prop of t.properties.slice(0, 8)) {
        const s = sanitizeProp(prop)
        if (s) chart += `    ${s}\n`
      }
      chart += `  }\n`
    } else if (t.kind === 'class') {
      chart += `  class ${t.safeName} {\n`
      for (const prop of t.properties.slice(0, 6)) {
        const s = sanitizeProp(prop)
        if (s) chart += `    +${s}\n`
      }
      for (const method of (t.methods || []).slice(0, 6)) {
        const s = sanitizeProp(method)
        if (s) chart += `    +${s}\n`
      }
      chart += `  }\n`
    } else {
      chart += `  class ${t.safeName} {\n    <<type>>\n`
      for (const prop of t.properties.slice(0, 5)) {
        const s = sanitizeProp(prop)
        if (s) chart += `    ${s}\n`
      }
      chart += `  }\n`
    }
    // Relationships
    if (t.extends) for (const ext of t.extends) {
      const safeExt = sanitizeName(ext.trim())
      if (safeExt && safeExt !== t.safeName && renderedNames.has(safeExt)) {
        chart += `  ${safeExt} <|-- ${t.safeName}\n`
        edgeCount++
      }
    }
    if (t.implements) for (const impl of t.implements) {
      const safeImpl = sanitizeName(impl.trim())
      if (safeImpl && renderedNames.has(safeImpl)) {
        chart += `  ${safeImpl} <|.. ${t.safeName}\n`
        edgeCount++
      }
    }
  }

  if (nodeCount === 0) chart = 'flowchart TD\n  empty["No classes, interfaces, or types found"]\n'

  const truncated = totalFound > MAX_TYPES ? ` (showing top ${nodeCount} of ${totalFound})` : ''

  return {
    type: 'classes',
    title: `Type & Class Diagram (${totalFound} types${truncated})`,
    chart,
    stats: { totalNodes: nodeCount, totalEdges: edgeCount },
    nodePathMap,
  }
}
