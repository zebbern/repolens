import { tool } from 'ai'
import {
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
import { generateTourSchema } from './tour-schemas'

/**
 * Shared client-side tool definitions used by both the chat and docs routes.
 * These tools have no `execute` function — tool calls are streamed to the client
 * for local execution against the CodeIndex.
 */
export const codeTools = {
  readFile: tool({
    description:
      'Read the full contents of a file, or a specific line range. Use startLine/endLine to read sections of large files efficiently. Always read files before making claims about their code.',
    inputSchema: readFileSchema,
  }),
  readFiles: tool({
    description: 'Read multiple files at once (max 10). More efficient than calling readFile repeatedly.',
    inputSchema: readFilesSchema,
  }),
  searchFiles: tool({
    description:
      'Search for files by path pattern or search for text content across all files. Returns matching file paths and line matches. Set isRegex=true to use regular expression patterns (e.g. "export\\s+function\\s+handle" to find exported functions starting with handle).',
    inputSchema: searchFilesSchema,
  }),
  listDirectory: tool({
    description: 'List files and subdirectories in a specific directory. Useful to explore folder structure.',
    inputSchema: listDirectorySchema,
  }),
  findSymbol: tool({
    description:
      'Find function, class, interface, type, or enum definitions across the codebase by name. Returns file path and line number.',
    inputSchema: findSymbolSchema,
  }),
  getFileStats: tool({
    description: 'Get statistics for a file: line count, language, imports, and exports.',
    inputSchema: getFileStatsSchema,
  }),
  analyzeImports: tool({
    description: 'Analyze import relationships for a file. Shows what it imports and what other files import it.',
    inputSchema: analyzeImportsSchema,
  }),
  scanIssues: tool({
    description: 'Run the code quality and security scanner on a specific file. Returns issues found with severity.',
    inputSchema: scanIssuesSchema,
  }),
  generateDiagram: tool({
    description: 'Generate a Mermaid diagram of the codebase. Types: summary (file distribution pie chart), topology (module dependency graph), import-graph (import relationship graph).',
    inputSchema: generateDiagramSchema,
  }),
  getProjectOverview: tool({
    description:
      'Get a comprehensive overview of the project: file count, languages, folder structure, key patterns, and repository metadata (stars, forks, topics, license) when available.',
    inputSchema: getProjectOverviewSchema,
  }),
  generateTour: tool({
    description:
      'Generate an annotated guided tour of the codebase. The tour consists of ordered stops, each pointing to a file and line range with a markdown explanation. Optionally focus the tour on a specific theme (e.g., "authentication flow", "data fetching", "error handling"). Returns a structured tour object.',
    inputSchema: generateTourSchema,
  }),
}
