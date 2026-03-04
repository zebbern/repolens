// AST Analyzer — barrel export for AST parsing + analysis modules

export {
  parseFileAST,
  getAST,
  clearASTCache,
  isASTEligible,
  AST_LANGUAGES,
} from './ast-parser'

export type { ParseResult, File } from './ast-parser'

export {
  analyzeAST,
  extractScopeInfo,
  findFunctionBodies,
  isRouteHandler,
  isExportedFunction,
} from './ast-analysis'

export type { ScopeInfo, FunctionBody } from './ast-analysis'
