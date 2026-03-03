// Export extraction — identifies exported symbols for JS/TS, Python, Go, and Rust.

import type { ExportInfo } from './types'

const NAMED_EXPORT_REGEX = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g
const DEFAULT_EXPORT_REGEX = /export\s+default\s+(?:(?:async\s+)?function|class)\s*(\w*)/g
const EXPORT_DEFAULT_ID_REGEX = /export\s+default\s+(\w+)\s*;?\s*$/gm

export function extractExports(content: string, lang: string): ExportInfo[] {
  // Only JS/TS have explicit export syntax
  if (lang !== 'typescript' && lang !== 'javascript') {
    // For Python: look for top-level def/class not starting with _
    if (lang === 'python') {
      const exports: ExportInfo[] = []
      const pyDef = /^(?:def|async\s+def)\s+(\w+)/gm
      const pyClass = /^class\s+(\w+)/gm
      let m: RegExpExecArray | null
      pyDef.lastIndex = 0
      while ((m = pyDef.exec(content)) !== null) {
        if (!m[1].startsWith('_')) exports.push({ name: m[1], kind: 'function', isDefault: false })
      }
      pyClass.lastIndex = 0
      while ((m = pyClass.exec(content)) !== null) {
        if (!m[1].startsWith('_')) exports.push({ name: m[1], kind: 'class', isDefault: false })
      }
      return exports
    }
    // For Go: look for uppercase-starting funcs
    if (lang === 'go') {
      const exports: ExportInfo[] = []
      const goFunc = /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?([A-Z]\w+)/gm
      let m: RegExpExecArray | null
      goFunc.lastIndex = 0
      while ((m = goFunc.exec(content)) !== null) {
        exports.push({ name: m[1], kind: 'function', isDefault: false })
      }
      return exports
    }
    // For Rust: pub items
    if (lang === 'rust') {
      const exports: ExportInfo[] = []
      const rustPub = /^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static|mod)\s+(\w+)/gm
      let m: RegExpExecArray | null
      rustPub.lastIndex = 0
      while ((m = rustPub.exec(content)) !== null) {
        exports.push({ name: m[1], kind: 'function', isDefault: false })
      }
      return exports
    }
    return []
  }

  const exports: ExportInfo[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null

  NAMED_EXPORT_REGEX.lastIndex = 0
  while ((m = NAMED_EXPORT_REGEX.exec(content)) !== null) {
    const name = m[1]
    if (seen.has(name)) continue
    seen.add(name)
    const line = content.slice(Math.max(0, m.index - 10), m.index + m[0].length + 10)
    const isDefault = /export\s+default/.test(line)
    let kind: ExportInfo['kind'] = 'unknown'
    if (/function/.test(m[0])) kind = 'function'
    else if (/class/.test(m[0])) kind = 'class'
    else if (/(?:const|let|var)/.test(m[0])) kind = 'variable'
    else if (/type/.test(m[0])) kind = 'type'
    else if (/interface/.test(m[0])) kind = 'interface'
    else if (/enum/.test(m[0])) kind = 'enum'
    if ((kind === 'function' || kind === 'variable') && /^[A-Z]/.test(name)) kind = 'component'
    exports.push({ name, kind, isDefault })
  }

  EXPORT_DEFAULT_ID_REGEX.lastIndex = 0
  while ((m = EXPORT_DEFAULT_ID_REGEX.exec(content)) !== null) {
    if (m[1] && !seen.has(m[1]) && /^[A-Z]/.test(m[1])) {
      seen.add(m[1])
      exports.push({ name: m[1], kind: 'unknown', isDefault: true })
    }
  }

  DEFAULT_EXPORT_REGEX.lastIndex = 0
  while ((m = DEFAULT_EXPORT_REGEX.exec(content)) !== null) {
    if (!m[1] && !seen.has('default')) {
      seen.add('default')
      exports.push({ name: 'default', kind: /function/.test(m[0]) ? 'function' : 'class', isDefault: true })
    }
  }

  return exports
}
