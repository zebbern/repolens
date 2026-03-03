// Rust import extraction — use declarations and mod statements.

import type { ResolvedImport } from '../types'
import { resolveRelativeImport } from '../utils'

const RUST_USE_REGEX = /^use\s+((?:crate|super|self)(?:::\w+)+(?:::\{[^}]+\})?|(\w+)(?:::\w+)*(?:::\{[^}]+\})?)/gm
const RUST_MOD_REGEX = /^mod\s+(\w+)\s*;/gm

export function extractRustImports(content: string, filePath: string, indexedPaths: Set<string>): ResolvedImport[] {
  const imports: ResolvedImport[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null

  RUST_USE_REGEX.lastIndex = 0
  while ((m = RUST_USE_REGEX.exec(content)) !== null) {
    const source = m[1]
    if (seen.has(source)) continue
    seen.add(source)
    const isCrate = source.startsWith('crate::') || source.startsWith('super::') || source.startsWith('self::')
    let resolvedPath: string | null = null
    if (isCrate) {
      const cleaned = source.replace(/^(crate|super|self)::/, '').replace(/::\{[^}]+\}$/, '')
      resolvedPath = resolveRelativeImport(cleaned.replace(/::/g, '/'), filePath, indexedPaths)
    }
    imports.push({ source, resolvedPath, specifiers: [], isExternal: !isCrate && !resolvedPath, isDefault: false })
  }

  RUST_MOD_REGEX.lastIndex = 0
  while ((m = RUST_MOD_REGEX.exec(content)) !== null) {
    const modName = m[1]
    const resolvedPath = resolveRelativeImport(modName, filePath, indexedPaths)
    imports.push({ source: modName, resolvedPath, specifiers: [modName], isExternal: false, isDefault: false })
  }

  return imports
}
