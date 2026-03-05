// Generator — Class / Type Diagram (works with Go structs, Rust structs/enums, Python classes)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult } from '../types'

export function generateClassDiagram(analysis: FullAnalysis): MermaidDiagramResult {
  const nodePathMap = new Map<string, string>()

  // Sanitize a name so it's valid as a Mermaid class identifier
  const sanitizeName = (n: string) => n.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Unknown'
  // Sanitize property/method text for display inside a class block.
  // Extracts a clean "name : Type" format from raw TypeScript declarations.
  const sanitizeProp = (p: string): string => {
    let s = p.trim()
    if (!s) return ''

    // Strip leading TypeScript keywords that add noise
    s = s.replace(/^(?:readonly|static|abstract|const|override|declare|public|private|protected)\s+/g, '')
    s = s.replace(/^(?:readonly|static|abstract|const|override|declare|public|private|protected)\s+/g, '')

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
      const trimmed = p.trim()
        .replace(/^(?:readonly|static|abstract|const|override|declare|public|private|protected)\s+/g, '')
        .replace(/^(?:readonly|static|abstract|const|override|declare|public|private|protected)\s+/g, '')
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

    let cleaned = trimmed
    cleaned = cleaned.replace(/^(?:readonly|static|abstract|const|override|declare|public|private|protected)\s+/g, '')
    cleaned = cleaned.replace(/^(?:readonly|static|abstract|const|override|declare|public|private|protected)\s+/g, '')

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
  const seenNames = new Set<string>()

  for (const [path, fileAnalysis] of analysis.files) {
    for (const t of fileAnalysis.types) {
      if (!t.exported && t.properties.length === 0) continue
      const safeName = sanitizeName(t.name)
      if (seenNames.has(safeName)) continue
      seenNames.add(safeName)
      const hasRel = !!(t.extends && t.extends.length > 0)
      const splitProps = splitRawProperties(t.properties)
      const isObj = t.kind === 'interface' || t.kind === 'enum' || isObjectLikeProperties(splitProps)
      allTypes.push({
        safeName, path, kind: t.kind as 'interface' | 'enum' | 'type',
        properties: splitProps, exported: t.exported, hasRelationship: hasRel,
        propCount: splitProps.length, extends: t.extends, isObjectType: isObj,
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
        isObjectType: true,
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
      for (const prop of getCleanProperties(t.properties, 6)) {
        const s = sanitizeProp(prop)
        if (s) chart += `    +${s}\n`
      }
      chart += `  }\n`
    } else if (t.kind === 'enum') {
      chart += `  class ${t.safeName} {\n    <<enumeration>>\n`
      for (const prop of t.properties.slice(0, 6)) {
        const s = sanitizeProp(prop)
        if (s) chart += `    ${s}\n`
      }
      chart += `  }\n`
    } else if (t.kind === 'class') {
      chart += `  class ${t.safeName} {\n`
      for (const prop of getCleanProperties(t.properties, 5)) {
        const s = sanitizeProp(prop)
        if (s) chart += `    +${s}\n`
      }
      for (const method of (t.methods || []).slice(0, 4)) {
        const s = sanitizeProp(method)
        if (s) chart += `    +${s}\n`
      }
      chart += `  }\n`
    } else if (t.isObjectType) {
      // Type alias with object-like body — extract real properties
      chart += `  class ${t.safeName} {\n    <<type>>\n`
      for (const prop of getCleanProperties(t.properties, 4)) {
        const s = sanitizeProp(prop)
        if (s) chart += `    ${s}\n`
      }
      chart += `  }\n`
    } else {
      // Non-object type alias (utility, union, intersection, conditional, mapped)
      // Could also be a mixed type with some clean properties buried in garbage.
      chart += `  class ${t.safeName} {\n    <<type>>\n`
      const cleanProps = getCleanProperties(t.properties, t.properties.length)
      if (cleanProps.length > 0) {
        // Enough clean properties passed the 50% threshold — show them
        for (const prop of cleanProps.slice(0, 4)) {
          const s = sanitizeProp(prop)
          if (s) chart += `    ${s}\n`
        }
      } else if (!t.properties.some(isCleanRawProperty)) {
        // No properties matched at all — genuinely non-object type, show compact signature
        const sig = buildTypeSignature(t.properties)
        if (sig) chart += `    ${sig}\n`
      }
      // else: some clean but <50% — show empty box (better than garbage)
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
