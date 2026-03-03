// JS/TS import extraction — ESM imports, CommonJS require, and re-exports.

import type { ResolvedImport } from '../types'
import { resolveRelativeImport, resolveAliasImport } from '../utils'

const IMPORT_REGEX = /import\s+(?:(?:type\s+)?(?:(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+))(?:\s*,\s*(?:(\{[^}]*\})|(\w+)))?\s+from\s+)?['"]([^'"]+)['"]/g
const REQUIRE_REGEX = /(?:const|let|var)\s+(?:(\{[^}]*\})|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const EXPORT_FROM_REGEX = /export\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/g

export function extractJsImports(content: string, filePath: string, indexedPaths: Set<string>): ResolvedImport[] {
  const imports: ResolvedImport[] = []
  const seen = new Set<string>()

  let m: RegExpExecArray | null
  IMPORT_REGEX.lastIndex = 0
  while ((m = IMPORT_REGEX.exec(content)) !== null) {
    const namedBraces = m[1] || m[4]
    const namespace = m[2]
    const defaultName = m[3] || m[5]
    const source = m[6]
    if (seen.has(source)) continue
    seen.add(source)

    const specifiers: string[] = []
    if (namedBraces) specifiers.push(...namedBraces.replace(/[{}]/g, '').split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim()).filter(Boolean))
    if (defaultName) specifiers.push(defaultName)
    if (namespace) specifiers.push(namespace.replace(/\*\s+as\s+/, ''))

    const isRelative = source.startsWith('.') || source.startsWith('/')
    const isAlias = /^[@~#]\//.test(source)
    let resolvedPath: string | null = null
    if (isRelative) resolvedPath = resolveRelativeImport(source, filePath, indexedPaths)
    else if (isAlias) resolvedPath = resolveAliasImport(source, indexedPaths)

    imports.push({ source, resolvedPath, specifiers, isExternal: !isRelative && !isAlias && !resolvedPath, isDefault: !!defaultName })
  }

  REQUIRE_REGEX.lastIndex = 0
  while ((m = REQUIRE_REGEX.exec(content)) !== null) {
    const source = m[3]
    if (seen.has(source)) continue
    seen.add(source)
    const specifiers: string[] = []
    if (m[1]) specifiers.push(...m[1].replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean))
    if (m[2]) specifiers.push(m[2])
    const isRelative = source.startsWith('.')
    const isAlias = /^[@~#]\//.test(source)
    let resolvedPath: string | null = null
    if (isRelative) resolvedPath = resolveRelativeImport(source, filePath, indexedPaths)
    else if (isAlias) resolvedPath = resolveAliasImport(source, indexedPaths)
    imports.push({ source, resolvedPath, specifiers, isExternal: !isRelative && !isAlias && !resolvedPath, isDefault: !!m[2] })
  }

  EXPORT_FROM_REGEX.lastIndex = 0
  while ((m = EXPORT_FROM_REGEX.exec(content)) !== null) {
    const source = m[1]
    if (seen.has(source)) continue
    seen.add(source)
    const isRelative = source.startsWith('.')
    const isAlias = /^[@~#]\//.test(source)
    let resolvedPath: string | null = null
    if (isRelative) resolvedPath = resolveRelativeImport(source, filePath, indexedPaths)
    else if (isAlias) resolvedPath = resolveAliasImport(source, indexedPaths)
    imports.push({ source, resolvedPath, specifiers: [], isExternal: !isRelative && !isAlias && !resolvedPath, isDefault: false })
  }

  return imports
}
