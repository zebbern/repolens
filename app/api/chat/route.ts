import { streamText, convertToModelMessages, stepCountIs, consumeStream, type UIMessage } from 'ai'
import * as z from 'zod'
import { createAIModel, getModelContextWindow } from '@/lib/ai/providers'
import { createContextCompactor } from '@/lib/ai/context-compactor'
import { codeTools } from '@/lib/ai/tool-definitions'
import { apiError } from '@/lib/api/error'

export const maxDuration = 120

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'data']),
  content: z.string().max(100_000).optional(),
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
  pinnedContext: z.string().max(200_000).optional(),
  maxSteps: z.number().int().min(10).max(100).optional(),
  compactionEnabled: z.boolean().optional(),
})

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiError('INVALID_JSON', 'Invalid JSON in request body', 400)
  }

  try {
    const parsed = chatRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return apiError(
        'VALIDATION_ERROR',
        'Invalid request',
        422,
        JSON.stringify(parsed.error.flatten().fieldErrors),
      )
    }
    const { messages: rawMessages, provider, model, apiKey, repoContext, structuralIndex, pinnedContext, maxSteps, compactionEnabled } = parsed.data
    const messages = rawMessages as unknown as UIMessage[]
    const stepBudget = maxSteps ?? 50

    // Build system prompt
    let systemPrompt = `You are CodeDoc, a senior software engineer with full access to the codebase. You help developers understand code, answer architecture questions, write documentation, and create diagrams.

## Your Philosophy
- Quality and accuracy over speed. Take as many tool calls as needed.
- ALWAYS read the actual code before making claims about it. Never guess or hallucinate.
- When you produce documentation or diagrams, verify them by re-reading the source files.
- If you're unsure about something, read more files. If you still can't verify, say so explicitly.
- Provide specific file paths, line references, and code snippets from the actual codebase.

## Your Capabilities
You have 11 tools to explore the codebase:
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
- **generateTour** — Create guided code tours with annotated stops when users ask for walkthroughs, tours, or step-by-step explanations of code flows.

You can create guided code tours using the generateTour tool when users ask for walkthroughs, tours, or step-by-step explanations of code flows. Tours consist of ordered stops at specific file locations with markdown annotations explaining each section.

## Self-Verification Protocol
After generating documentation or making claims about code:
1. Re-read the key files you referenced to verify accuracy
2. Cross-check function signatures, type definitions, and import chains
3. If you find a discrepancy, correct your output and note the correction

## Step Budget
You have up to ${stepBudget} tool-call rounds. Plan your approach:
- Use readFiles (batch) to read up to 10 files in a single round — this is far more efficient than individual readFile calls
- Use readFile with startLine/endLine to read only the section you need from large files
- For broad exploration: listDirectory + searchFiles first, then targeted reads
- Budget roughly: 60% exploration/reading, 25% generating output, 15% verification
- If approaching the step limit, prioritize completing your output over reading more files

## Model Context
Your context window is approximately ${getModelContextWindow(model).toLocaleString()} tokens. The structural index has been sized accordingly.

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

${pinnedContext ? `
## Pinned Files (User-Selected Context)
The user has explicitly pinned these files. Use this content directly — no need to call readFile for these files.

${pinnedContext}
` : ''}
## Important
- You have 11 tools — use them to read and explore real code before answering
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
      ...(compactionEnabled && {
        prepareStep: createContextCompactor({
          maxSteps: stepBudget,
          contextWindow: getModelContextWindow(model),
          provider,
        }),
      }),
      stopWhen: stepCountIs(stepBudget),
      abortSignal: req.signal,
      ...(compactionEnabled && provider === 'anthropic' && {
        providerOptions: {
          anthropic: {
            contextManagement: {
              edits: [
                {
                  type: 'clear_tool_uses_20250919' as const,
                  trigger: { type: 'input_tokens' as const, value: 80_000 },
                  keep: { type: 'tool_uses' as const, value: 10 },
                  clearAtLeast: { type: 'input_tokens' as const, value: 5_000 },
                  clearToolInputs: false,
                },
                {
                  type: 'compact_20260112' as const,
                  trigger: { type: 'input_tokens' as const, value: 150_000 },
                  instructions: 'Summarize the codebase analysis so far, preserving: all file paths examined, key code structure findings (exports, imports, patterns), decisions made about the codebase, and what remains to be analyzed.',
                  pauseAfterCompaction: false,
                },
              ],
            },
          },
        },
      }),
    })

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      consumeSseStream: consumeStream,
    })
  } catch (error) {
    console.error('Chat API error:', error instanceof Error ? error.message : 'Unknown error')
    return apiError(
      'CHAT_ERROR',
      error instanceof Error ? error.message : 'An error occurred',
      500,
    )
  }
}
