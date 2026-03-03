import { streamText, convertToModelMessages, stepCountIs, consumeStream } from 'ai'
import * as z from 'zod'
import { createAIModel } from '@/lib/ai/providers'
import { createCodeTools } from '@/lib/ai/tools'

export const maxDuration = 120

type DocType = 'architecture' | 'setup' | 'api-reference' | 'file-explanation' | 'custom'

const docsRequestSchema = z.object({
  messages: z.array(z.any()),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1),
  apiKey: z.string().min(1),
  docType: z.enum(['architecture', 'setup', 'api-reference', 'file-explanation', 'custom']),
  repoContext: z.object({
    name: z.string(),
    description: z.string(),
    structure: z.string(),
  }),
  fileContents: z.record(z.string(), z.string()),
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
- Cite actual functions, classes, and patterns from code you inspected`,

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
- If you can't determine something, say "check with the team" rather than guessing`,

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
- Read every file before documenting its exports`,

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
- Explain WHY, not just WHAT`,

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
- Be thorough but concise`,
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
    const { messages, provider, model, apiKey, docType, repoContext, fileContents, targetFile } = parsed.data

    // Build the file content map for tool access
    const fileMap = new Map(Object.entries(fileContents || {}))

    // Shared code-browsing tools
    const codeTools = createCodeTools(fileMap)

    // Build system prompt
    let systemPrompt = DOC_SYSTEM_PROMPTS[docType] || DOC_SYSTEM_PROMPTS['custom']

    systemPrompt += `\n\n## Repository
**Name:** ${repoContext.name}
**Description:** ${repoContext.description || 'No description'}
**Total files indexed:** ${fileMap.size}

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
- You have access to readFile, searchFiles, and listDirectory tools
- ALWAYS read files before documenting them -- never guess or hallucinate
- Read at least the key files for the doc type before writing
- Your final response should be the complete documentation in markdown`

    const result = streamText({
      model: createAIModel(provider, model, apiKey),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: codeTools,
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
