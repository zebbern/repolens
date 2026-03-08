import { createAgentUIStreamResponse, consumeStream, smoothStream, type UIMessage } from 'ai'
import * as z from 'zod'
import { repoLensAgent } from '@/lib/ai/agent'
import { SKILL_ID_SCHEMA } from '@/lib/ai/skills/types'
import { apiError } from '@/lib/api/error'
import { applyRateLimit } from '@/lib/api/rate-limit'
import type { NextRequest } from 'next/server'

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
  activeSkills: z.array(SKILL_ID_SCHEMA).max(10).optional(),
})

export async function POST(req: NextRequest) {
  const rateLimited = applyRateLimit(req, { limit: 10, windowMs: 60_000 })
  if (rateLimited) return rateLimited

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
    const { messages: rawMessages, ...rest } = parsed.data
    const messages = rawMessages as unknown as UIMessage[]

    return await createAgentUIStreamResponse({
      agent: repoLensAgent,
      uiMessages: messages,
      options: { mode: 'chat' as const, ...rest },
      abortSignal: req.signal,
      // UIMessage[] doesn't match the generic TOOLS-dependent message type
      originalMessages: messages as never[],
      consumeSseStream: consumeStream,
      experimental_transform: smoothStream({ delayInMs: 10 }),
      onStepFinish: ({ stepNumber, usage, toolCalls }) => {
        console.log(
          `[AI] Step ${stepNumber}: ${toolCalls?.length ?? 0} tool calls, ${usage?.totalTokens ?? 0} tokens`,
        )
      },
      messageMetadata: ({ part }) => {
        if (part.type === 'finish') {
          return {
            usage: {
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
              totalTokens: part.totalUsage.totalTokens ?? 0,
            },
          }
        }
      },
    })
  } catch (error) {
    console.error('Chat API error:', error instanceof Error ? error.message : 'Unknown error')
    return apiError(
      'CHAT_ERROR',
      'An unexpected error occurred',
      500,
    )
  }
}
