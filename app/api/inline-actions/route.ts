import { streamText } from 'ai'
import type { NextRequest } from 'next/server'
import * as z from 'zod'
import { createUntrustedContextMessage } from '@/lib/ai/agent/prompt-context'
import { createAIModel } from '@/lib/ai/providers'
import { aiRequestSchemaError, readBoundedAIRequest } from '@/lib/api/ai-request'
import { apiError } from '@/lib/api/error'
import { applyRateLimit } from '@/lib/api/rate-limit'

export const maxDuration = 60

const VALID_SYMBOL_KINDS = [
  'function', 'class', 'interface', 'type', 'variable',
  'enum', 'method', 'property',
] as const

const inlineActionSchema = z.object({
  action: z.enum(['explain', 'refactor', 'complexity']),
  symbolCode: z.string().min(1).max(50_000),
  symbolName: z.string().min(1).max(200),
  symbolKind: z.enum(VALID_SYMBOL_KINDS),
  filePath: z.string().min(1).max(4_096),
  language: z.string().min(1).max(50),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(500),
})

function buildSystemPrompt(action: string, symbolKind: string): string {
  switch (action) {
    case 'explain':
      return `You are a senior software engineer. Explain this ${symbolKind} clearly and concisely. Cover what it does, its parameters and return value (if applicable), key logic, and any notable patterns or edge cases. Use markdown formatting with code examples where helpful. Keep the explanation focused and practical.`
    case 'refactor':
      return `You are a senior software engineer specializing in code quality. Suggest improvements for this ${symbolKind}. Consider readability, maintainability, performance, and best practices. Provide concrete before/after code snippets for each suggestion. Be specific and actionable — explain *why* each change is an improvement.`
    case 'complexity':
      return `You are a senior software engineer specializing in algorithmic analysis. Analyze the complexity of this ${symbolKind}. Cover:
- **Time complexity**: Big-O notation with explanation of the dominant operations
- **Space complexity**: Additional memory usage beyond inputs
- **Cyclomatic complexity**: Number of independent paths through the code
- **Suggestions**: Ways to reduce complexity if applicable

Use markdown formatting. Be precise and reference specific lines or expressions in the code.`
    default:
      return `You are a senior software engineer. Analyze this ${symbolKind}.`
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = applyRateLimit(req, { bucket: '/api/inline-actions' })
  if (rateLimited) return rateLimited

  const raw = await readBoundedAIRequest(req)
  if (!raw.success) return raw.response

  try {
    const parsed = inlineActionSchema.safeParse(raw.data)
    if (!parsed.success) {
      return aiRequestSchemaError(parsed.error)
    }

    const { action, symbolCode, symbolName, symbolKind, filePath, language, provider, model, apiKey } = parsed.data

    const systemPrompt = buildSystemPrompt(action, symbolKind)
    const contextMessage = createUntrustedContextMessage([{
      kind: 'pinned-files',
      data: { filePath, language, symbolCode, symbolName, symbolKind },
    }])

    const result = streamText({
      model: createAIModel(provider, model, apiKey),
      system: systemPrompt,
      messages: [
        contextMessage,
        { role: 'user' as const, content: `Analyze the selected ${symbolKind} for the requested ${action} action.` },
      ],
      abortSignal: req.signal,
    })

    return result.toTextStreamResponse()
  } catch (error) {
    console.error('Inline action API error:', error instanceof Error ? error.message : 'Unknown error')
    return apiError(
      'INLINE_ACTION_ERROR',
      'Inline action generation failed',
      500,
    )
  }
}
