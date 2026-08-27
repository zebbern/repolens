// Generator — Class / Type Diagram (works with Go structs, Rust structs/enums, Python classes)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult } from '../types'
import { escapeMermaidLabel, sanitizeId, MERMAID_EDGE_BUDGET, MERMAID_SOURCE_BUDGET } from '../helpers'

export function generateClassDiagram(analysis: FullAnalysis): MermaidDiagramResult {
  const nodePathMap = new Map<string, string>()

  // Sanitize a name so it's valid as a Mermaid class identifier
  const sanitizeName = (n: string) => n.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Unknown'
  const sanitizeClassIdentifier = (name: string): string => `type_${sanitizeName(name)}`

  // Strip all leading TypeScript modifiers from a declaration string
  const MOD_RE = /^(?:readonly|static|abstract|const|override|declare|public|private|protected)\s+/
  function stripModifiers(s: string): string {
    while (MOD_RE.test(s)) s = s.replace(MOD_RE, '')
    return s
  }
  // Sanitize property/method text for display inside a class block.
  // Extracts a clean "name : Type" format from raw TypeScript declarations.
  const sanitizeProp = (p: string): string => {
    let s = p.trim()
    if (!s) return ''

    // Strip leading TypeScript keywords that add noise
    s = stripModifiers(s)

    // Try to extract  name: type  pattern — only when the part before ":"
    // is a simple identifier (not a complex expression with generics, parens, etc.)
    const colonIdx = s.indexOf(':')
    if (colonIdx > 0) {
      const rawName = s.slice(0, colonIdx).trim()
      if (/^[a-zA-Z_$][\w$]*\??$/.test(rawName)) {
        const name = rawName.replace(/\?$/, '') // strip optional marker
        let type = s.slice(colonIdx + 1).trim()

        // Simplify function types to "Function"
        if (/\(.*\)\s*=>/.test(type) || /^\s*\(/.test(type)) {
          type = 'Function'
        }
        // Strip generics: Record<string, string> → Record (3 passes for nesting)
        type = type.replace(/<[^<>]*>/g, '')
        type = type.replace(/<[^<>]*>/g, '')
        type = type.replace(/<[^<>]*>/g, '')
        // Strip noise keywords
        type = type.replace(/\b(?:extends|infer|keyof|typeof|readonly)\b/g, '').trim()
        // Strip Mermaid-unsafe characters, keep alphanumeric/spaces/dots/underscores
        type = type.replace(/[{}()<>\[\]|~"'`?;*#@$&\\=/,]/g, ' ').replace(/\s+/g, ' ').trim()

        if (name && type) {
          const result = `${name} : ${type}`
          return result.length > 40 ? result.slice(0, 37) + '...' : result
        }
        return name || ''
      }
    }

    // Method signature: name(...): ReturnType
    const methodMatch = s.match(/^([a-zA-Z_$][\w$]*)\s*\(/)
    if (methodMatch) {
      const name = methodMatch[1]
      const retMatch = s.match(/\)\s*:\s*(.+)$/)
      if (retMatch) {
        let ret = retMatch[1].replace(/<[^<>]*>/g, '').replace(/<[^<>]*>/g, '')
        ret = ret.replace(/[{}()<>\[\]|~"'`?;*#@$&\\=/,]/g, ' ').replace(/\s+/g, ' ').trim()
        if (ret) {
          const result = `${name}() ${ret}`
          return result.length > 40 ? result.slice(0, 37) + '...' : result
        }
      }
      return `${name}()`
    }

    // ── Type expression cleanup (for type alias body fragments) ──
    // Strip generic type parameters (3 passes for nested generics)
    s = s.replace(/<[^<>]*>/g, '')
    s = s.replace(/<[^<>]*>/g, '')
    s = s.replace(/<[^<>]*>/g, '')

    // Strip conditional type tails: "A extends B ? C : D" → keep only "A"
    if (/\s+\?\s+/.test(s)) {
      s = s.split(/\s+\?\s+/)[0].trim()
    }

    // Strip "extends ..." clauses
    s = s.replace(/\s+extends\s+\S[^,&|]*/g, '').trim()

    // Strip "infer X" tokens
    s = s.replace(/\binfer\s+\w+/g, '').trim()

    // Strip "keyof" / "typeof" keywords (keep what follows)
    s = s.replace(/\b(?:keyof|typeof)\s+/g, '').trim()

    // Replace function expressions: (...) => ... → Function
    s = s.replace(/\([^)]*\)\s*=>\s*\S+/g, 'Function').trim()

    // Replace mapped type syntax: { [K in ...]: ... } → MappedType
    s = s.replace(/\{[^}]*\[.*\bin\b.*\].*\}/g, 'MappedType').trim()

    // Clean up: keep only Mermaid-safe characters
    s = s.replace(/[^a-zA-Z0-9_.\s-]/g, ' ').replace(/\s+/g, ' ').trim()

    // If still too many words, truncate to keep it readable
    const words = s.split(/\s+/)
    if (words.length > 4) {
      s = words.slice(0, 3).join(' ')
    }

    if (s.length > 40) s = s.slice(0, 37) + '...'
    return s
  }

  // ── Split concatenated property strings into individual declarations ──
  // CodeIndex may jam multiple declarations into a single string, e.g.
  //   "state: S version: number export interface PersistOptions..."
  // This splits them before further classification.
  function splitRawProperties(properties: string[]): string[] {
    const result: string[] = []
    for (const raw of properties) {
      // Split on semicolons or newlines first
      const lines = raw.split(/[;\n]/).filter(s => s.trim())
      for (const line of lines) {
        // Further split concatenated property declarations:
        // "num: number numGet: number" → ["num: number", "numGet: number"]
        // Requires a word char before whitespace and an identifier+colon after.
        const subProps = line.split(/(?<=\w)\s+(?=[a-zA-Z_$][\w$]*\??\s*:)/)
        result.push(...subProps)
      }
    }
    return result
  }

  // ── Classify whether a type alias has real object properties or is a type expression ──
  // Real properties: lines matching `identifier[?]: typeExpression`
  // Type expressions: utility types like `Omit<T, K>`, union members, conditionals, etc.
  const PROPERTY_PATTERN = /^[a-zA-Z_$][\w$]*\??\s*:/
  const METHOD_PATTERN = /^[a-zA-Z_$][\w$]*\s*\(/

  function isObjectLikeProperties(properties: string[]): boolean {
    if (properties.length === 0) return false
    const realPropCount = properties.filter(p => {
      const trimmed = stripModifiers(p.trim())
      return PROPERTY_PATTERN.test(trimmed) || METHOD_PATTERN.test(trimmed)
    }).length
    // Consider it object-like if at least half the "properties" look like real declarations
    return realPropCount > 0 && realPropCount >= properties.length / 2
  }

  // Build a compact type signature for non-object type aliases
  function buildTypeSignature(properties: string[]): string {
    // properties from the parser are: union members (split by |) or intersection members (split by &)
    // or a single body fragment. Rejoin them into a readable signature.
    const joined = properties.length > 1
      ? properties.join(' | ')
      : properties[0] || ''
    // Strip generics for readability (3 passes for nesting)
    let sig = joined
      .replace(/<[^<>]*>/g, '')
      .replace(/<[^<>]*>/g, '')
      .replace(/<[^<>]*>/g, '')
    // Clean Mermaid-unsafe characters
    sig = sig.replace(/[{}()<>\[\]|~"'`?;*#@$&\\=/,]/g, ' ').replace(/\s+/g, ' ').trim()
    if (sig.length > 50) sig = sig.slice(0, 47) + '...'
    return sig
  }

  // ── Property validation — filter garbage from CodeIndex body extraction ──
  const GARBAGE_LINE_PREFIXES = /^(?:export\s|import\s|\/\/|\/\*|\*\s)/
  const TS_DECLARATION_KEYWORDS = new Set([
    'export', 'function', 'import', 'type', 'interface', 'extends',
    'implements', 'module', 'namespace', 'class', 'enum',
  ])

  /**
   * Check if a raw property string is a clean member declaration.
   * Clean: `identifier[?]: Type` or `identifier(params): Type`
   * Garbage: starts with leaked keywords/comments or identifier is a TS keyword.
   */
  function isCleanRawProperty(raw: string): boolean {
    const trimmed = raw.trim()
    if (!trimmed) return false
    if (GARBAGE_LINE_PREFIXES.test(trimmed)) return false

    const cleaned = stripModifiers(trimmed)

    const propMatch = cleaned.match(/^([a-zA-Z_$][\w$]{0,29})\??\s*:/)
    if (propMatch) return !TS_DECLARATION_KEYWORDS.has(propMatch[1])

    const methodMatch = cleaned.match(/^([a-zA-Z_$][\w$]{0,29})\s*\(/)
    if (methodMatch) return !TS_DECLARATION_KEYWORDS.has(methodMatch[1])

    return false
  }

  /**
   * Filter properties to only clean declarations (up to `limit` entries).
   * Returns empty array if fewer than 50% pass — signals empty class box.
   */
  function getCleanProperties(properties: string[], limit: number): string[] {
    const limited = properties.slice(0, limit)
    if (limited.length === 0) return []
    const clean = limited.filter(isCleanRawProperty)
    return clean.length >= limited.length / 2 ? clean : []
  }

  // First pass: collect ALL types/classes and score them by importance
  type TypeEntry = {
    safeName: string
    displayName: string
    path: string
    kind: 'interface' | 'enum' | 'type' | 'class'
    properties: string[]
    methods?: string[]
    extends?: string[]
    implements?: string[]
    exported: boolean
    hasRelationship: boolean // has extends/implements
    propCount: number
    isObjectType: boolean // true if properties are real declarations, false for type expressions
  }
  const allTypes: TypeEntry[] = []

  for (const [path, fileAnalysis] of analysis.files) {
    for (const t of fileAnalysis.types) {
      if (!t.exported && t.properties.length === 0) continue
      const safeName = sanitizeClassIdentifier(t.name)
      const hasRel = !!(t.extends && t.extends.length > 0)
      const splitProps = splitRawProperties(t.properties)
      const isObj = t.kind === 'interface' || t.kind === 'enum' || isObjectLikeProperties(splitProps)
      allTypes.push({
        safeName, displayName: t.name, path, kind: t.kind as 'interface' | 'enum' | 'type',
        properties: splitProps, exported: t.exported, hasRelationship: hasRel,
        propCount: splitProps.length, extends: t.extends, isObjectType: isObj,
      })
    }
    for (const cls of fileAnalysis.classes) {
      const safeName = sanitizeClassIdentifier(cls.name)
      const hasRel = !!(cls.extends || (cls.implements && cls.implements.length > 0))
      allTypes.push({
        safeName, displayName: cls.name, path, kind: 'class',
        properties: cls.properties, methods: cls.methods, exported: true,
        hasRelationship: hasRel, propCount: cls.properties.length + cls.methods.length,
        extends: cls.extends ? [cls.extends] : undefined, implements: cls.implements,
        isObjectType: true,
      })
    }
  }

  // Mermaid class identifiers must be unique even when separate modules
  // declare the same readable type name. Keep the simple name for unique
  // declarations and add a path-derived suffix only for duplicates.
  const nameCounts = new Map<string, number>()
  for (const t of allTypes) nameCounts.set(t.safeName, (nameCounts.get(t.safeName) || 0) + 1)
  const usedIds = new Set<string>()
  for (const t of allTypes) {
    const base = t.safeName
    if ((nameCounts.get(base) || 0) > 1) {
      const pathId = sanitizeId(t.path).replace(/[^a-zA-Z0-9_]/g, '_')
      t.safeName = `${base}_${pathId}`
    }
    let id = t.safeName
    let suffix = 2
    while (usedIds.has(id)) id = `${t.safeName}_${suffix++}`
    t.safeName = id
    usedIds.add(id)
  }
  const typesByName = new Map<string, TypeEntry[]>()
  for (const t of allTypes) {
    const list = typesByName.get(sanitizeName(t.displayName)) || []
    list.push(t)
    typesByName.set(sanitizeName(t.displayName), list)
  }
  const resolveType = (name: string, owner: TypeEntry): TypeEntry | undefined => {
    const requestedName = name.trim()
    const matchingCandidates = typesByName.get(sanitizeName(requestedName)) || []
    const exactCandidates = matchingCandidates.filter(candidate => candidate.displayName === requestedName)
    const candidates = exactCandidates.length > 0 ? exactCandidates : matchingCandidates
    if (candidates.length === 0) return undefined
    const sameFile = candidates.find(candidate => candidate.path === owner.path)
    if (sameFile) return sameFile
    const imports = analysis.files.get(owner.path)?.imports || []
    const imported = candidates.filter(candidate => imports.some(imp => imp.resolvedPath === candidate.path && imp.specifiers.includes(requestedName)))
    if (imported.length === 1) return imported[0]
    return candidates.length === 1 ? candidates[0] : undefined
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
      const parent = resolveType(ext, t)
      if (parent && !renderedNames.has(parent.safeName)) {
        typesToRender.push(parent); renderedNames.add(parent.safeName)
      }
    }
    if (t.implements) for (const impl of t.implements) {
      const parent = resolveType(impl, t)
      if (parent && !renderedNames.has(parent.safeName)) {
        typesToRender.push(parent); renderedNames.add(parent.safeName)
      }
    }
  }

  // ── Composition edges — type reference extraction ──
  const BUILTIN_TYPES = new Set([
    'Promise', 'Array', 'Record', 'Map', 'Set', 'Date', 'Error',
    'RegExp', 'Symbol', 'Function', 'Object',
    'Partial', 'Required', 'Readonly', 'Pick', 'Omit',
    'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'InstanceType',
    'Parameters', 'ConstructorParameters', 'ThisType', 'Awaited',
    'WeakMap', 'WeakSet', 'WeakRef', 'Iterator', 'Generator',
    'PromiseLike', 'ArrayLike',
  ])

  function extractReferencedTypes(raw: string): string[] {
    const trimmed = stripModifiers(raw.trim())
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx <= 0) return []
    const typePart = trimmed.slice(colonIdx + 1)
    const refs: string[] = []
    const regex = /\b([A-Z][a-zA-Z0-9_]+)\b/g
    let match
    while ((match = regex.exec(typePart)) !== null) {
      // Skip UPPER_SNAKE_CASE constants (e.g. MAX_LENGTH)
      if (/^[A-Z][A-Z0-9_]+$/.test(match[1])) continue
      if (!BUILTIN_TYPES.has(match[1])) refs.push(match[1])
    }
    return refs
  }

  // ── Pass 1: Compute all edges before applying display limits ──
  type EdgeEntry = { from: string; to: string; syntax: string }
  const allRelationshipEdges: EdgeEntry[] = []
  const compositionEdgeKeys = new Set<string>()

  for (const t of allTypes) {
    if (t.extends) for (const ext of t.extends) {
      const parent = resolveType(ext, t)
      if (parent && parent.safeName !== t.safeName) {
        allRelationshipEdges.push({ from: parent.safeName, to: t.safeName, syntax: `  ${parent.safeName} <|-- ${t.safeName}` })
      }
    }
    if (t.implements) for (const impl of t.implements) {
      const parent = resolveType(impl, t)
      if (parent) {
        allRelationshipEdges.push({ from: parent.safeName, to: t.safeName, syntax: `  ${parent.safeName} <|.. ${t.safeName}` })
      }
    }
    const members = [...t.properties, ...(t.methods || [])]
    for (const member of members) {
      for (const ref of extractReferencedTypes(member)) {
        const referenced = resolveType(ref, t)
        if (referenced && referenced.safeName !== t.safeName) {
          const edgeKey = `${t.safeName}--${referenced.safeName}`
          if (!compositionEdgeKeys.has(edgeKey)) {
            compositionEdgeKeys.add(edgeKey)
            allRelationshipEdges.push({ from: t.safeName, to: referenced.safeName, syntax: `  ${t.safeName} *-- ${referenced.safeName}` })
          }
        }
      }
    }
  }
  const allEdges = allRelationshipEdges.filter(edge => renderedNames.has(edge.from) && renderedNames.has(edge.to))

  // ── Build connected types set ──
  const connectedTypes = new Set<string>()
  for (const edge of allEdges) {
    connectedTypes.add(edge.from)
    connectedTypes.add(edge.to)
  }

  // ── Filter to connected types, or fallback to top 10 by propCount ──
  let typesToDisplay: TypeEntry[]
  let isFallback = false
  if (connectedTypes.size > 0) {
    typesToDisplay = typesToRender.filter(t => connectedTypes.has(t.safeName))
  } else {
    isFallback = true
    typesToDisplay = [...typesToRender]
      .sort((a, b) => b.propCount - a.propCount)
      .slice(0, 10)
  }

  // ── Derive module name from file path ──
  function getModule(filePath: string): { idSource: string; label: string } {
    const lastSlash = filePath.lastIndexOf('/')
    if (lastSlash < 0) return { idSource: 'repository-root:', label: 'root' }
    const directory = filePath.slice(0, lastSlash)
    return { idSource: `directory:${directory}`, label: directory || 'root' }
  }

  // ── Render a single type block ──
  function renderTypeBlock(t: TypeEntry, indent: string): string {
    let block = ''
    const classRef = (name: string) => `${name}["${escapeMermaidLabel(t.displayName)}"]`
    if (t.kind === 'interface') {
      block += `${indent}class ${classRef(t.safeName)} {\n${indent}  <<interface>>\n`
      for (const prop of getCleanProperties(t.properties, 6)) {
        const s = sanitizeProp(prop)
        if (s) block += `${indent}  +${s}\n`
      }
      block += `${indent}}\n`
    } else if (t.kind === 'enum') {
      block += `${indent}class ${classRef(t.safeName)} {\n${indent}  <<enumeration>>\n`
      for (const prop of t.properties.slice(0, 6)) {
        const s = sanitizeProp(prop)
        if (s) block += `${indent}  ${s}\n`
      }
      block += `${indent}}\n`
    } else if (t.kind === 'class') {
      block += `${indent}class ${classRef(t.safeName)} {\n`
      for (const prop of getCleanProperties(t.properties, 5)) {
        const s = sanitizeProp(prop)
        if (s) block += `${indent}  +${s}\n`
      }
      for (const method of (t.methods || []).slice(0, 4)) {
        const s = sanitizeProp(method)
        if (s) block += `${indent}  +${s}\n`
      }
      block += `${indent}}\n`
    } else if (t.isObjectType) {
      block += `${indent}class ${classRef(t.safeName)} {\n${indent}  <<type>>\n`
      for (const prop of getCleanProperties(t.properties, 4)) {
        const s = sanitizeProp(prop)
        if (s) block += `${indent}  ${s}\n`
      }
      block += `${indent}}\n`
    } else {
      block += `${indent}class ${classRef(t.safeName)} {\n${indent}  <<type>>\n`
      const cleanProps = getCleanProperties(t.properties, t.properties.length)
      if (cleanProps.length > 0) {
        for (const prop of cleanProps.slice(0, 4)) {
          const s = sanitizeProp(prop)
          if (s) block += `${indent}  ${s}\n`
        }
      } else if (!t.properties.some(isCleanRawProperty)) {
        const sig = buildTypeSignature(t.properties)
        if (sig) block += `${indent}  ${sig}\n`
      }
      block += `${indent}}\n`
    }
    return block
  }

  // ── Pass 2: Render a deterministic, bounded diagram ──
  const edgeDegree = new Map<string, number>()
  for (const edge of allEdges) {
    edgeDegree.set(edge.from, (edgeDegree.get(edge.from) || 0) + 1)
    edgeDegree.set(edge.to, (edgeDegree.get(edge.to) || 0) + 1)
  }
  const rankedTypes = [...typesToDisplay].sort((a, b) => {
    const degree = (edgeDegree.get(b.safeName) || 0) - (edgeDegree.get(a.safeName) || 0)
    return degree !== 0 ? degree : a.safeName.localeCompare(b.safeName)
  })
  const typesById = new Map(typesToDisplay.map(type => [type.safeName, type]))
  const edgeOrderedTypes: TypeEntry[] = []
  const edgeOrderedIds = new Set<string>()
  const rankedEdges = [...allEdges].sort((left, right) => {
    const leftDegree = (edgeDegree.get(left.from) || 0) + (edgeDegree.get(left.to) || 0)
    const rightDegree = (edgeDegree.get(right.from) || 0) + (edgeDegree.get(right.to) || 0)
    return rightDegree - leftDegree || `${left.from}|${left.to}`.localeCompare(`${right.from}|${right.to}`)
  })
  for (const edge of rankedEdges) {
    for (const id of [edge.to, edge.from]) {
      const type = typesById.get(id)
      if (type && !edgeOrderedIds.has(id)) {
        edgeOrderedIds.add(id)
        edgeOrderedTypes.push(type)
      }
    }
  }
  const orderedTypes = [...edgeOrderedTypes, ...rankedTypes.filter(type => !edgeOrderedIds.has(type.safeName))]

  const renderBounded = (maxTypes: number) => {
    const selectedTypes = orderedTypes.slice(0, maxTypes)
    const selectedNames = new Set(selectedTypes.map(t => t.safeName))
    const groups = new Map<string, { label: string; types: TypeEntry[] }>()
    for (const t of selectedTypes) {
      const moduleInfo = getModule(t.path)
      const namespaceId = `module_${sanitizeId(moduleInfo.idSource)}`
      if (!groups.has(namespaceId)) groups.set(namespaceId, { label: moduleInfo.label, types: [] })
      groups.get(namespaceId)!.types.push(t)
    }
    let renderedChart = 'classDiagram\n'
    const renderedMap = new Map<string, string>()
    for (const [namespaceId, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      renderedChart += `  namespace ${namespaceId}["${escapeMermaidLabel(group.label)}"] {\n`
      const { types } = group
      for (const t of types) {
        renderedMap.set(t.safeName, t.path)
        renderedChart += renderTypeBlock(t, '    ')
      }
      renderedChart += '  }\n'
    }
    const eligibleEdges = allEdges.filter(edge => selectedNames.has(edge.from) && selectedNames.has(edge.to))
    const renderedEdges = eligibleEdges.slice(0, MERMAID_EDGE_BUDGET)
    for (const edge of renderedEdges) renderedChart += `${edge.syntax}\n`
    const omittedNodes = totalFound - selectedTypes.length
    const omittedEdges = allRelationshipEdges.length - renderedEdges.length
    if (omittedNodes > 0 || omittedEdges > 0) renderedChart += `%% ${omittedNodes} nodes and ${omittedEdges} edges omitted\n`
    return { chart: renderedChart, nodePathMap: renderedMap, nodeCount: selectedTypes.length, edgeCount: renderedEdges.length, omittedNodes, omittedEdges }
  }

  let low = 0
  let high = orderedTypes.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (renderBounded(mid).chart.length <= MERMAID_SOURCE_BUDGET) low = mid
    else high = mid - 1
  }
  const rendered = renderBounded(low)
  for (const [id, path] of rendered.nodePathMap) nodePathMap.set(id, path)
  const chart = rendered.nodeCount === 0 ? 'flowchart TD\n  empty["No classes, interfaces, or types found"]\n' : rendered.chart
  const title = isFallback || rendered.nodeCount === 0
    ? `Type & Class Diagram (${rendered.nodeCount} of ${totalFound} types)`
    : `Type Relationships (${rendered.nodeCount} connected types from ${totalFound} total)`

  return {
    type: 'classes',
    title,
    chart,
    stats: { totalNodes: rendered.nodeCount, totalEdges: rendered.edgeCount, omittedNodes: rendered.omittedNodes, omittedEdges: rendered.omittedEdges },
    nodePathMap,
  }
}
