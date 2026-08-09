import { z } from 'zod'

const pathSchema = z.string().max(4_096)
const refSchema = z.string().max(256)
export const commitShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/i)

// ── Core tool schemas (shared between chat + docs routes) ──

export const readFileSchema = z.object({
  path: pathSchema.describe('File path relative to repo root'),
  startLine: z.number().int().positive().optional().describe('Start line (1-based, inclusive). Use with endLine to read specific sections.'),
  endLine: z.number().int().positive().optional().describe('End line (1-based, inclusive). Use with startLine to read specific sections.'),
})

export const readFilesSchema = z.object({
  paths: z.array(pathSchema).max(10).describe('Array of file paths to read (max 10)'),
})

export const searchFilesSchema = z.object({
  query: z.string().describe('Search query -- matches against file paths AND file contents. Supports regex when isRegex is true.'),
  maxResults: z.number().optional().describe('Max results to return. Defaults to 15.'),
  isRegex: z.boolean().optional().describe('When true, treat query as a regular expression pattern. Defaults to false.'),
})

export const listDirectorySchema = z.object({
  path: pathSchema.describe('Directory path relative to repo root, e.g. "src" or "src/components". Use "" for root.'),
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
  path: pathSchema.describe('File path'),
})

export const analyzeImportsSchema = z.object({
  path: pathSchema.describe('File path to analyze imports for'),
})

export const scanIssuesSchema = z.object({
  path: pathSchema.describe('File path to scan'),
})

export const generateDiagramSchema = z.object({
  type: z
    .enum(['summary', 'topology', 'import-graph'])
    .describe('Diagram type: summary (file distribution pie chart), topology (module dependency graph), or import-graph (import relationship graph)'),
  focusFile: pathSchema.optional().describe('Optional file path to focus the diagram on'),
})

export const getProjectOverviewSchema = z.object({})

export const getGitHistorySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('commits').describe('Fetch recent commits for the repository or a specific file'),
    sha: refSchema.optional().describe('Branch name or commit SHA to start listing from'),
    path: pathSchema.optional().describe('File path to get commits for. When provided, returns only commits that touched this file'),
    maxResults: z.number().int().positive().max(100).default(20).describe('Maximum number of commits to return (default 20, max 100)'),
  }),
  z.object({
    mode: z.literal('blame').describe('Get line-by-line blame (authorship) data for a file'),
    path: pathSchema.describe('File path relative to repo root to get blame for'),
    ref: refSchema.optional().describe('Git ref (branch or commit SHA) to blame at. Defaults to the default branch'),
  }),
  z.object({
    mode: z.literal('commit-detail').describe('Get full details of a single commit including file changes and stats'),
    sha: commitShaSchema.describe('The commit SHA to get details for'),
  }),
])

// Re-export tour schema for convenience
export { generateTourSchema } from './tour-schemas'

// ── PR Review tool schema ──

export const reviewPRFileSchema = z.object({
  file: pathSchema.describe('File path from the PR diff to review'),
  patch: z.string().describe('The unified diff patch content for this file'),
  context: z.string().optional().describe('Optional additional context about the file (e.g., its role in the codebase)'),
})
