// Barrel re-exports for the parser module.

export * from './types'
export { analyzeCodebase } from './analyzer'
export { computeTopology } from './topology'
export { detectCircularDeps } from './graph'
export { extractExports } from './extract-exports'
export { extractTypes, extractClasses, extractJsxComponents } from './extract-types'
export { extractImports } from './languages'
export { detectLang, detectPrimaryLanguage, normalizePath, resolveRelativeImport, resolveAliasImport, CODE_EXTENSIONS, EXT_TO_LANG } from './utils'
export { detectFramework } from './framework-detection'
