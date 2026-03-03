// Type, class, and JSX component extraction for multiple languages.

import type { ExtractedType, ExtractedClass } from './types'

// ---------------------------------------------------------------------------
// Type/Interface/Enum extraction
// ---------------------------------------------------------------------------

const INTERFACE_REGEX = /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g
const TYPE_REGEX = /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=\s*([^;]+)/g
const ENUM_REGEX = /(?:export\s+)?enum\s+(\w+)\s*\{([^}]*)\}/g

export function extractTypes(content: string, lang: string): ExtractedType[] {
  if (lang !== 'typescript' && lang !== 'javascript') {
    // Go structs
    if (lang === 'go') {
      const types: ExtractedType[] = []
      const goStruct = /type\s+(\w+)\s+struct\s*\{([^}]*)\}/g
      let m: RegExpExecArray | null
      goStruct.lastIndex = 0
      while ((m = goStruct.exec(content)) !== null) {
        const props = m[2].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'))
        types.push({ name: m[1], kind: 'interface', properties: props, exported: /^[A-Z]/.test(m[1]) })
      }
      const goInterface = /type\s+(\w+)\s+interface\s*\{([^}]*)\}/g
      goInterface.lastIndex = 0
      while ((m = goInterface.exec(content)) !== null) {
        const props = m[2].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'))
        types.push({ name: m[1], kind: 'interface', properties: props, exported: /^[A-Z]/.test(m[1]) })
      }
      return types
    }
    // Rust structs/enums
    if (lang === 'rust') {
      const types: ExtractedType[] = []
      const rustStruct = /(?:pub\s+)?struct\s+(\w+)(?:<[^>]*>)?\s*\{([^}]*)\}/g
      let m: RegExpExecArray | null
      rustStruct.lastIndex = 0
      while ((m = rustStruct.exec(content)) !== null) {
        const props = m[2].split(',').map(l => l.trim()).filter(l => l && !l.startsWith('//'))
        types.push({ name: m[1], kind: 'interface', properties: props, exported: content.slice(Math.max(0, m.index - 5), m.index).includes('pub') })
      }
      const rustEnum = /(?:pub\s+)?enum\s+(\w+)(?:<[^>]*>)?\s*\{([^}]*)\}/g
      rustEnum.lastIndex = 0
      while ((m = rustEnum.exec(content)) !== null) {
        const props = m[2].split(',').map(l => l.trim().split('(')[0].split('{')[0].trim()).filter(Boolean)
        types.push({ name: m[1], kind: 'enum', properties: props, exported: content.slice(Math.max(0, m.index - 5), m.index).includes('pub') })
      }
      return types
    }
    // Python classes (as types)
    if (lang === 'python') {
      const types: ExtractedType[] = []
      // dataclasses/pydantic
      const pyDataclass = /@dataclass[\s\S]*?class\s+(\w+)(?:\(([^)]*)\))?\s*:([\s\S]*?)(?=\nclass\s|\n[^\s]|\Z)/g
      let m: RegExpExecArray | null
      pyDataclass.lastIndex = 0
      while ((m = pyDataclass.exec(content)) !== null) {
        const props = m[3].split('\n').map(l => l.trim()).filter(l => l && l.includes(':') && !l.startsWith('#') && !l.startsWith('def'))
        types.push({ name: m[1], kind: 'interface', properties: props, exported: !m[1].startsWith('_') })
      }
      return types
    }
    return []
  }

  const types: ExtractedType[] = []
  let m: RegExpExecArray | null

  INTERFACE_REGEX.lastIndex = 0
  while ((m = INTERFACE_REGEX.exec(content)) !== null) {
    const name = m[1]
    const extendsStr = m[2]
    const body = m[3]
    const exported = content.slice(Math.max(0, m.index - 8), m.index).includes('export')
    const properties = body.split('\n').map(l => l.trim().replace(/;$/, '').trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('/*'))
    const exts = extendsStr ? extendsStr.split(',').map(s => s.trim()).filter(Boolean) : undefined
    types.push({ name, kind: 'interface', properties, extends: exts, exported })
  }

  TYPE_REGEX.lastIndex = 0
  while ((m = TYPE_REGEX.exec(content)) !== null) {
    const name = m[1]
    const body = m[2].trim()
    const exported = content.slice(Math.max(0, m.index - 8), m.index).includes('export')
    const properties = body.includes('|')
      ? body.split('|').map(s => s.trim()).filter(Boolean)
      : body.includes('&')
        ? body.split('&').map(s => s.trim()).filter(Boolean)
        : [body]
    types.push({ name, kind: 'type', properties, exported })
  }

  ENUM_REGEX.lastIndex = 0
  while ((m = ENUM_REGEX.exec(content)) !== null) {
    const name = m[1]
    const body = m[2]
    const exported = content.slice(Math.max(0, m.index - 8), m.index).includes('export')
    const properties = body.split(',').map(s => s.trim().split('=')[0].trim()).filter(Boolean)
    types.push({ name, kind: 'enum', properties, exported })
  }

  return types
}

// ---------------------------------------------------------------------------
// Class extraction
// ---------------------------------------------------------------------------

const CLASS_REGEX = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/g

export function extractClasses(content: string, lang: string): ExtractedClass[] {
  if (lang !== 'typescript' && lang !== 'javascript') {
    // Python classes
    if (lang === 'python') {
      const classes: ExtractedClass[] = []
      const pyClass = /^class\s+(\w+)(?:\(([^)]*)\))?\s*:/gm
      let m: RegExpExecArray | null
      pyClass.lastIndex = 0
      while ((m = pyClass.exec(content)) !== null) {
        const name = m[1]
        const bases = m[2] ? m[2].split(',').map(s => s.trim()).filter(Boolean) : []
        // Rough method extraction
        const afterClass = content.slice(m.index)
        const methodRegex = /^\s{4}(?:async\s+)?def\s+(\w+)/gm
        const methods: string[] = []
        let mm: RegExpExecArray | null
        methodRegex.lastIndex = 0
        while ((mm = methodRegex.exec(afterClass)) !== null) {
          if (mm.index > 2000) break // Don't scan too far
          if (mm[1] !== '__init__') methods.push(mm[1])
        }
        classes.push({ name, methods, properties: [], extends: bases[0], implements: bases.length > 1 ? bases.slice(1) : undefined, exported: !name.startsWith('_') })
      }
      return classes
    }
    return []
  }

  const classes: ExtractedClass[] = []
  let m: RegExpExecArray | null

  CLASS_REGEX.lastIndex = 0
  while ((m = CLASS_REGEX.exec(content)) !== null) {
    const name = m[1]
    const ext = m[2] || undefined
    const impl = m[3] ? m[3].split(',').map(s => s.trim()).filter(Boolean) : undefined
    const exported = content.slice(Math.max(0, m.index - 8), m.index).includes('export')

    const startIdx = content.indexOf('{', m.index + m[0].length - 1)
    let depth = 1
    let endIdx = startIdx + 1
    while (depth > 0 && endIdx < content.length) {
      if (content[endIdx] === '{') depth++
      else if (content[endIdx] === '}') depth--
      endIdx++
    }
    const body = content.slice(startIdx + 1, endIdx - 1)

    const methodRegex = /(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)/g
    const methods: string[] = []
    let mm: RegExpExecArray | null
    methodRegex.lastIndex = 0
    while ((mm = methodRegex.exec(body)) !== null) {
      if (mm[1] !== 'constructor' && mm[1] !== 'if' && mm[1] !== 'for' && mm[1] !== 'while') methods.push(mm[1])
    }

    const propRegex = /^\s*(?:readonly\s+)?(?:private\s+|public\s+|protected\s+)?(\w+)\s*[?!]?\s*:/gm
    const properties: string[] = []
    let pm: RegExpExecArray | null
    propRegex.lastIndex = 0
    while ((pm = propRegex.exec(body)) !== null) {
      if (!methods.includes(pm[1])) properties.push(pm[1])
    }

    classes.push({ name, methods, properties, extends: ext, implements: impl, exported })
  }

  return classes
}

// ---------------------------------------------------------------------------
// JSX component extraction (React/Preact/Solid)
// ---------------------------------------------------------------------------

const JSX_TAG_REGEX = /<([A-Z]\w+)(?:\s|\/|>)/g

export function extractJsxComponents(content: string, lang: string): string[] {
  if (lang !== 'typescript' && lang !== 'javascript') return []
  const components = new Set<string>()
  let m: RegExpExecArray | null
  JSX_TAG_REGEX.lastIndex = 0
  while ((m = JSX_TAG_REGEX.exec(content)) !== null) {
    if (m[1].length > 1 && /^[A-Z]/.test(m[1])) components.add(m[1])
  }
  return Array.from(components)
}
