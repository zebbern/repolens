import { z } from 'zod'

// ── Core tool schemas (shared between chat + docs routes) ──

export const readFileSchema = z.object({
  path: z.string().describe('File path relative to repo root'),
  startLine: z.number().int().positive().optional().describe('Start line (1-based, inclusive). Use with endLine to read specific sections.'),
  endLine: z.number().int().positive().optional().describe('End line (1-based, inclusive). Use with startLine to read specific sections.'),
})

export const readFilesSchema = z.object({
  paths: z.array(z.string()).max(10).describe('Array of file paths to read (max 10)'),
})

export const searchFilesSchema = z.object({
  query: z.string().describe('Search query -- matches against file paths AND file contents. Supports regex when isRegex is true.'),
  maxResults: z.number().nullable().describe('Max results to return. Defaults to 15.'),
  isRegex: z.boolean().optional().describe('When true, treat query as a regular expression pattern. Defaults to false.'),
})

export const listDirectorySchema = z.object({
  path: z.string().describe('Directory path relative to repo root, e.g. "src" or "src/components". Use "" for root.'),
})

// ── Advanced tool schemas (chat route only) ──

export const findSymbolSchema = z.object({
  name: z.string().describe('Symbol name to search for (function, class, interface, type, enum name)'),
  kind: z
    .enum(['function', 'class', 'interface', 'type', 'enum', 'any'])
    .describe('Symbol kind filter')
    .optional(),
})

export const getFileStatsSchema = z.object({
  path: z.string().describe('File path'),
})

export const analyzeImportsSchema = z.object({
  path: z.string().describe('File path to analyze imports for'),
})

export const scanIssuesSchema = z.object({
  path: z.string().describe('File path to scan'),
})

export const generateDiagramSchema = z.object({
  type: z
    .enum([
      'summary',
      'topology',
      'import-graph',
      'class-diagram',
      'entry-points',
      'module-usage',
      'treemap',
      'external-deps',
      'focus-diagram',
    ])
    .describe('Diagram type'),
  focusFile: z.string().optional().describe('For focus-diagram: the file path to focus on'),
})

export const getProjectOverviewSchema = z.object({})
