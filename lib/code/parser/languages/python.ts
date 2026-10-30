// Python import extraction — from/import statements.

import type { ResolvedImport } from '../types'

/** `<dir>/<parts>.py` or the package `<dir>/<parts>/__init__.py`, if indexed. */
function resolveModuleIn(dir: string, parts: string[], indexedPaths: Set<string>): string | null {
  const base = [dir, ...parts].filter(Boolean).join('/')
  if (!base) return null
  if (parts.length > 0 && indexedPaths.has(`${base}.py`)) return `${base}.py`
  if (indexedPaths.has(`${base}/__init__.py`)) return `${base}/__init__.py`
  return null
}

/**
 * Resolve `from <source> import <names>` / `import <source>` to an indexed file.
 * Relative sources count leading dots from the importer's package; absolute
 * sources resolve from the repository root, then from the importer's directory.
 */
function resolvePythonModule(
  source: string,
  names: string[],
  filePath: string,
  indexedPaths: Set<string>,
): string | null {
  const importerDir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
  const dots = source.match(/^\.*/)![0].length
  const parts = source.slice(dots).split('.').filter(Boolean)

  if (dots === 0) {
    return resolveModuleIn('', parts, indexedPaths) ?? resolveModuleIn(importerDir, parts, indexedPaths)
  }

  // One dot is the importer's own package; each further dot goes up one level.
  const dirParts = importerDir ? importerDir.split('/') : []
  if (dots - 1 > dirParts.length) return null
  const packageDir = dirParts.slice(0, dirParts.length - (dots - 1)).join('/')
  if (parts.length > 0) return resolveModuleIn(packageDir, parts, indexedPaths)

  // `from . import name`: a submodule when one exists, otherwise the package itself.
  for (const name of names) {
    const submodule = resolveModuleIn(packageDir, [name], indexedPaths)
    if (submodule) return submodule
  }
  return resolveModuleIn(packageDir, [], indexedPaths)
}

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
      const resolvedPath = resolvePythonModule(source, specifiers, filePath, indexedPaths)
      const isExternal = !resolvedPath && !isRelative
      imports.push({ source, resolvedPath, specifiers, isExternal, isDefault: false })
    } else if (m[3]) {
      // import X, Y
      for (const mod of m[3].split(',').map(s => s.trim()).filter(Boolean)) {
        if (seen.has(mod)) continue
        seen.add(mod)
        const resolvedPath = resolvePythonModule(mod, [], filePath, indexedPaths)
        imports.push({ source: mod, resolvedPath, specifiers: [mod.split('.').pop() || mod], isExternal: !resolvedPath, isDefault: false })
      }
    }
  }

  return imports
}
