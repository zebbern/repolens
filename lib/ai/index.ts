export { createAIModel, getModelContextWindow, getMaxIndexBytesForModel } from './providers'
export type { AIProvider } from './providers'

export {
  readFileSchema,
  readFilesSchema,
  searchFilesSchema,
  listDirectorySchema,
  findSymbolSchema,
  getFileStatsSchema,
  analyzeImportsSchema,
  scanIssuesSchema,
  generateDiagramSchema,
  getProjectOverviewSchema,
} from './tool-schemas'

export {
  buildStructuralIndex,
  extractSignature,
  getLanguagePatterns,
  getImportRegex,
  getExportRegex,
  extractExports,
  extractImports,
  extractSignatures,
  extractExportsAsync,
  extractImportsAsync,
  extractSignaturesAsync,
  isCodeFile,
  inferLanguage,
  SYMBOL_PATTERNS,
  IMPORT_REGEX,
} from './structural-index'
export { executeToolLocally } from './client-tool-executor'

export { createContextCompactor } from './context-compactor'

export { handleToolCall } from './tool-call-handler'
export type { ToolCallInfo, AddToolOutputFn } from './tool-call-handler'
