import { streamText, convertToModelMessages, stepCountIs, consumeStream, tool } from 'ai'
import * as z from 'zod'
import { createAIModel } from '@/lib/ai/providers'
import { createContextCompactor } from '@/lib/ai/context-compactor'
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
} from '@/lib/ai/tool-schemas'

export const maxDuration = 120

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'data']),
  content: z.string().max(100_000),
}).passthrough() // Allow AI SDK's additional fields (parts, toolInvocations, etc.)

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(200),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1),
  apiKey: z.string().min(1).max(500),
  repoContext: z.object({
    name: z.string(),
    description: z.string(),
    structure: z.string().max(200_000),
  }).optional(),
  structuralIndex: z.string().max(500_000).optional(),
})

export async function POST(req: Request) {
  try {
    const raw = await req.json()
    const parsed = chatRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const { messages, provider, model, apiKey, repoContext, structuralIndex } = parsed.data

    // Client-side tools — no execute function, tool calls stream to client
    const codeTools = {
      readFile: tool({ description: 'Read the full contents of a file. Always read files before making claims about their code.', inputSchema: readFileSchema }),
      readFiles: tool({ description: 'Read multiple files at once (max 10). More efficient than calling readFile repeatedly.', inputSchema: readFilesSchema }),
      searchFiles: tool({ description: 'Search for files by path pattern or search for text content across all files. Returns matching file paths and line matches. Set isRegex=true to use regular expression patterns (e.g. "export\\s+function\\s+handle" to find exported functions starting with handle).', inputSchema: searchFilesSchema }),
      listDirectory: tool({ description: 'List files and subdirectories in a specific directory. Useful to explore folder structure.', inputSchema: listDirectorySchema }),
      findSymbol: tool({ description: 'Find function, class, interface, type, or enum definitions across the codebase by name. Returns file path and line number.', inputSchema: findSymbolSchema }),
      getFileStats: tool({ description: 'Get statistics for a file: line count, language, imports, and exports.', inputSchema: getFileStatsSchema }),
      analyzeImports: tool({ description: 'Analyze import relationships for a file. Shows what it imports and what other files import it.', inputSchema: analyzeImportsSchema }),
      scanIssues: tool({ description: 'Run the code quality and security scanner on a specific file. Returns issues found with severity.', inputSchema: scanIssuesSchema }),
      generateDiagram: tool({ description: 'Generate a Mermaid diagram of the codebase. Types: summary, topology, import-graph, class-diagram, entry-points, module-usage, treemap, external-deps, focus-diagram.', inputSchema: generateDiagramSchema }),
      getProjectOverview: tool({ description: 'Get a comprehensive overview of the project: file count, languages, folder structure, and key patterns.', inputSchema: getProjectOverviewSchema }),
    }

    // Build system prompt
    let systemPrompt = `You are CodeDoc, a senior software engineer with full access to the codebase. You help developers understand code, answer architecture questions, write documentation, and create diagrams.

## Your Philosophy
- Quality and accuracy over speed. Take as many tool calls as needed.
- ALWAYS read the actual code before making claims about it. Never guess or hallucinate.
- When you produce documentation or diagrams, verify them by re-reading the source files.
- If you're unsure about something, read more files. If you still can't verify, say so explicitly.
- Provide specific file paths, line references, and code snippets from the actual codebase.

## Your Capabilities
You have 10 tools to explore the codebase:
- **readFile** — Read any file in full. Use this before discussing any code.
- **readFiles** — Read multiple files at once (up to 10) for efficiency.
- **searchFiles** — Search for text patterns or file names across the entire codebase. Supports regex patterns with isRegex=true.
- **listDirectory** — Browse the folder structure.
- **findSymbol** — Find function, class, interface, type, or enum definitions by name.
- **getFileStats** — Get line count, language, imports, and exports for a file.
- **analyzeImports** — See what a file imports and what imports it (dependency relationships).
- **scanIssues** — Run security and quality checks on a specific file.
- **generateDiagram** — Create Mermaid diagrams of the codebase architecture.
- **getProjectOverview** — Get project statistics and structure summary.

## Self-Verification Protocol
After generating documentation or making claims about code:
1. Re-read the key files you referenced to verify accuracy
2. Cross-check function signatures, type definitions, and import chains
3. If you find a discrepancy, correct your output and note the correction

## Response Guidelines
- Use markdown formatting: headings, lists, tables, code blocks
- Put code examples in fenced blocks with correct language tags: \`\`\`typescript
- Reference files as \`path/to/file.tsx\`
- When creating Mermaid diagrams, wrap them in \`\`\`mermaid blocks
- For long explanations, use clear section headers
- When writing documentation, follow the file → understand → write → verify cycle

## Mermaid Diagram Guidelines
Valid diagram types: flowchart, sequenceDiagram, classDiagram, erDiagram, gantt, pie, gitgraph, mindmap.

Syntax rules:
- Use \`-->\` for flowchart arrows, never \`->\`
- Wrap labels containing special characters in quotes: \`A["Label with (parens)"]\`
- ALWAYS quote node labels containing file paths or slashes: \`A["components/features/chat"]\` NOT \`A[components/features/chat]\`
- Unquoted \`[/text]\` is trapezoid syntax in mermaid — always quote labels with paths to avoid parse errors
- Every \`subgraph\` must have a matching \`end\`
- Sequence diagram arrows: \`->>\` (solid), \`-->>\` (dashed)
- Never use empty node labels or HTML entities in labels
- Node IDs must be alphanumeric (no spaces or punctuation)

Before outputting a diagram, mentally verify:
1. All subgraphs are closed with \`end\`
2. Arrow syntax is consistent throughout
3. The diagram type keyword is on the first line with no extra text`

    if (repoContext) {
      systemPrompt += `

## Connected Repository
**Name:** ${repoContext.name}
**Description:** ${repoContext.description || 'No description'}

## Structural Index
Below is a JSON index of every file in the codebase with metadata including exports, imports, and symbol signatures.

**Use this index BEFORE making tool calls:**
- Scan \`exports\` to find where functions, classes, and types are defined
- Trace \`imports\` to understand dependency chains between files
- Read \`symbols\` to see function signatures — parameters and return types tell you what code does without reading the file
- Only call readFile when you need the full implementation, not just the API surface

This index saves you tool calls and makes your answers more accurate. Start here, then drill into specific files.

${structuralIndex || 'Not available'}

## File Tree
\`\`\`
${repoContext.structure}
\`\`\`

## Important
- You have 10 tools — use them to read and explore real code before answering
- NEVER describe a file you haven't read — use readFile first
- ALWAYS reference actual files from the codebase`
    } else {
      systemPrompt += `

No repository is currently connected. You can still answer general programming questions, but won't be able to reference specific codebase files.`
    }

    const result = streamText({
      model: createAIModel(provider, model, apiKey),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: codeTools,
      prepareStep: createContextCompactor(),
      stopWhen: stepCountIs(50),
      abortSignal: req.signal,
    })

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      consumeSseStream: consumeStream,
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'An error occurred',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
