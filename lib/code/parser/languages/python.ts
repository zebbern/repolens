// Python import extraction — from/import statements.

import type { ResolvedImport } from '../types'
import { resolveRelativeImport } from '../utils'

const PY_IMPORT_REGEX = /^(?:from\s+([\w.]+)\s+import\s+(.+)|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/gm

export function extractPythonImports(content: string, filePath: string, indexedPaths: Set<string>): ResolvedImport[] {
  const imports: ResolvedImport[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null

  PY_IMPORT_REGEX.lastIndex = 0
  while ((m = PY_IMPORT_REGEX.exec(content)) !== null) {
    if (m[1]) {
      // from X import Y
      const source = m[1]
      if (seen.has(source)) continue
      seen.add(source)
      const specifiers = m[2].split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim()).filter(Boolean)
      const isRelative = source.startsWith('.')
      let resolvedPath: string | null = null
      if (isRelative) resolvedPath = resolveRelativeImport(source, filePath, indexedPaths)
      else resolvedPath = resolveRelativeImport(source.replace(/\./g, '/'), filePath, indexedPaths)
      const isExternal = !resolvedPath && !isRelative
      imports.push({ source, resolvedPath, specifiers, isExternal, isDefault: false })
    } else if (m[3]) {
      // import X, Y
      for (const mod of m[3].split(',').map(s => s.trim()).filter(Boolean)) {
        if (seen.has(mod)) continue
        seen.add(mod)
        const resolvedPath = resolveRelativeImport(mod.replace(/\./g, '/'), filePath, indexedPaths)
        imports.push({ source: mod, resolvedPath, specifiers: [mod.split('.').pop() || mod], isExternal: !resolvedPath, isDefault: false })
      }
    }
  }

  return imports
}
