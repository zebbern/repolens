import { streamText, convertToModelMessages, stepCountIs, consumeStream, tool } from 'ai'
import * as z from 'zod'
import { createAIModel, getModelContextWindow } from '@/lib/ai/providers'
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

type DocType = 'architecture' | 'setup' | 'api-reference' | 'file-explanation' | 'custom'

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'data']),
  content: z.string().max(100_000),
}).passthrough() // Allow AI SDK's additional fields (parts, toolInvocations, etc.)

const docsRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(200),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1),
  apiKey: z.string().min(1).max(500),
  docType: z.enum(['architecture', 'setup', 'api-reference', 'file-explanation', 'custom']),
  repoContext: z.object({
    name: z.string(),
    description: z.string(),
    structure: z.string().max(200_000),
  }),
  structuralIndex: z.string().max(500_000).optional(),
  targetFile: z.string().nullish(),
})

/**
 * System prompts per doc type.
 * Key difference from before: these instruct the AI to USE TOOLS to read files,
 * not guess from a snippet dump.
 */
const DOC_SYSTEM_PROMPTS: Record<DocType, string> = {
  'architecture': `You are a senior software architect writing documentation for a codebase.

## Your task
Produce a clear, well-structured **Architecture Overview** document.

## Your approach
1. Start by reviewing the file tree to understand the project structure
2. Use readFile to read key entry points, config files, and core modules
3. Follow import chains -- when you see a file imports another, read that file too
4. Only document what you have actually read and verified

## Required sections
1. **Project Summary** - What the project does (2-3 sentences)
2. **High-Level Architecture** - System structure (layers, modules, patterns)
3. **Key Modules** - What each major folder/module does, with specific file references
4. **Data Flow** - How data moves through the system
5. **Key Design Decisions** - Patterns, frameworks, architectural choices
6. **Module Relationships** - How modules depend on and communicate with each other

## Rules
- NEVER describe a file you haven't read -- use readFile first
- Reference specific file paths as \`inline code\`
- Use mermaid diagrams where helpful (wrap in \`\`\`mermaid blocks)
- In mermaid diagrams, ALWAYS quote node labels containing file paths or slashes: \`A["src/lib/utils.ts"]\` NOT \`A[src/lib/utils.ts]\`. Unquoted \`[/text]\` triggers trapezoid syntax and causes parse errors
- Cite actual functions, classes, and patterns from code you inspected

## Step Budget
You have 25 tool-call rounds. Plan efficiently:
- Use readFiles (batch, up to 10 files) to maximize reads per round
- Use readFile with startLine/endLine for large files
- Budget: ~15 rounds reading, ~5 writing, ~5 verifying
- Prioritize the most important files first -- not every file needs to be read`,

  'setup': `You are a developer experience expert writing a **Getting Started / Setup Guide**.

## Your approach
1. Read package.json / pyproject.toml / Cargo.toml / go.mod to find dependencies and scripts
2. Read config files (.env.example, tsconfig, docker-compose, etc.)
3. Read README if it exists for any existing setup notes
4. Read entry points to understand how the app starts

## Required sections
1. **Prerequisites** - Required tools, runtimes, versions (from actual config files)
2. **Installation** - Step-by-step commands
3. **Configuration** - Environment variables, config files, API keys needed
4. **Running the Project** - Commands to start dev server, build, test
5. **Project Structure** - Brief folder overview for new developers
6. **Common Issues** - Likely problems based on the tech stack

## Rules
- ONLY include setup steps you can verify from the code
- Put all commands in fenced code blocks
- If you can't determine something, say "check with the team" rather than guessing

## Step Budget
You have 25 tool-call rounds. Plan efficiently:
- Use readFiles (batch, up to 10 files) to maximize reads per round
- Use readFile with startLine/endLine for large files
- Budget: ~15 rounds reading, ~5 writing, ~5 verifying
- Prioritize the most important files first -- not every file needs to be read`,

  'api-reference': `You are a technical writer creating an **API Reference**.

## Your approach
1. Use searchFiles to find exported functions, classes, types, and interfaces
2. Read each file that contains public exports
3. Document the actual signatures, parameters, and return types from code

## Required format per export
1. **Name and Type** - Function, class, type, interface, constant
2. **Signature** - Full type signature (copied from actual code)
3. **Description** - What it does (1-2 sentences)
4. **Parameters** - Each param with type and description
5. **Return Value** - What it returns
6. **Usage Example** - Brief code example

## Rules
- NEVER invent function signatures -- copy them from the actual code
- Group by file or module
- Use \`typescript\` (or appropriate language) fenced code blocks
- Focus on PUBLIC API -- skip internal helpers unless important
- Read every file before documenting its exports

## Step Budget
You have 25 tool-call rounds. Plan efficiently:
- Use readFiles (batch, up to 10 files) to maximize reads per round
- Use readFile with startLine/endLine for large files
- Budget: ~15 rounds reading, ~5 writing, ~5 verifying
- Prioritize the most important files first -- not every file needs to be read`,

  'file-explanation': `You are a code educator explaining a specific file in detail.

## Your approach
1. Read the target file completely
2. Read files it imports to understand dependencies
3. Use searchFiles to find which files import this one (to understand its role)
4. Build a complete understanding before writing

## Required sections
1. **Purpose** - What this file does and why it exists
2. **How It Fits** - Where it sits in the architecture, what uses it
3. **Key Functions/Classes** - Each significant export explained
4. **Logic Walkthrough** - Step through the main logic flow
5. **Important Details** - Edge cases, patterns used, potential gotchas

## Rules
- Read the actual file and its dependencies before explaining
- Reference specific line content when discussing code
- Quote short snippets in fenced blocks
- Explain WHY, not just WHAT

## Step Budget
You have 25 tool-call rounds. Plan efficiently:
- Use readFiles (batch, up to 10 files) to maximize reads per round
- Use readFile with startLine/endLine for large files
- Budget: ~15 rounds reading, ~5 writing, ~5 verifying
- Prioritize the most important files first -- not every file needs to be read`,

  'custom': `You are a senior developer and technical writer. The user will ask you to generate specific documentation.

## Your approach
1. Read the file tree to orient yourself
2. Use readFile and searchFiles to find and read relevant code
3. Build understanding from actual code before writing

## Rules
- Use tools to read code -- never guess or hallucinate file contents
- Reference specific files, functions, and code
- Use markdown with clear headings
- Put code examples in fenced blocks with correct language tags
- Be thorough but concise

## Step Budget
You have 25 tool-call rounds. Plan efficiently:
- Use readFiles (batch, up to 10 files) to maximize reads per round
- Use readFile with startLine/endLine for large files
- Budget: ~15 rounds reading, ~5 writing, ~5 verifying
- Prioritize the most important files first -- not every file needs to be read`,
}

export async function POST(req: Request) {
  try {
    const raw = await req.json()
    const parsed = docsRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const { messages, provider, model, apiKey, docType, repoContext, structuralIndex, targetFile } = parsed.data

    // Client-side tools — no execute function, tool calls stream to client
    const codeTools = {
      readFile: tool({ description: 'Read the full contents of a file, or a specific line range. Use startLine/endLine to read sections of large files efficiently. Always read files before making claims about their code.', inputSchema: readFileSchema }),
      readFiles: tool({ description: 'Read multiple files at once (max 10). More efficient than calling readFile repeatedly.', inputSchema: readFilesSchema }),
      searchFiles: tool({ description: 'Search for files by path pattern or search for text content across all files. Set isRegex=true for regex patterns.', inputSchema: searchFilesSchema }),
      listDirectory: tool({ description: 'List files and subdirectories in a specific directory.', inputSchema: listDirectorySchema }),
      findSymbol: tool({ description: 'Find function, class, interface, type, or enum definitions across the codebase by name. Returns file path and line number.', inputSchema: findSymbolSchema }),
      getFileStats: tool({ description: 'Get statistics for a file: line count, language, imports, and exports.', inputSchema: getFileStatsSchema }),
      analyzeImports: tool({ description: 'Analyze import relationships for a file. Shows what it imports and what other files import it.', inputSchema: analyzeImportsSchema }),
      scanIssues: tool({ description: 'Run the code quality and security scanner on a specific file. Returns issues found with severity.', inputSchema: scanIssuesSchema }),
      generateDiagram: tool({ description: 'Generate a Mermaid diagram of the codebase. Types: summary, topology, import-graph, class-diagram, entry-points, module-usage, treemap, external-deps, focus-diagram.', inputSchema: generateDiagramSchema }),
      getProjectOverview: tool({ description: 'Get a comprehensive overview of the project: file count, languages, folder structure, and key patterns.', inputSchema: getProjectOverviewSchema }),
    }

    // Build system prompt
    let systemPrompt = DOC_SYSTEM_PROMPTS[docType] || DOC_SYSTEM_PROMPTS['custom']

    systemPrompt += `\n\n## Repository
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
\`\`\``

    if (targetFile) {
      systemPrompt += `\n\n## Target File
The user is asking specifically about: \`${targetFile}\`
Start by reading this file with readFile.`
    }

    systemPrompt += `\n\n## Important
- You have access to readFile, readFiles, searchFiles, listDirectory, findSymbol, getFileStats, analyzeImports, scanIssues, generateDiagram, and getProjectOverview tools
- ALWAYS read files before documenting them -- never guess or hallucinate
- Read at least the key files for the doc type before writing
- Your final response should be the complete documentation in markdown

## Model Context
Your context window is approximately ${getModelContextWindow(model).toLocaleString()} tokens. The structural index has been sized accordingly.`

    const result = streamText({
      model: createAIModel(provider, model, apiKey),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: codeTools,
      prepareStep: createContextCompactor(),
      stopWhen: stepCountIs(25), // Allow up to 25 tool-call rounds
      abortSignal: req.signal,
    })

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      consumeSseStream: consumeStream,
    })
  } catch (error) {
    console.error('Docs API error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'An error occurred' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
