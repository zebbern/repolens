import { createAgentUIStreamResponse, smoothStream, consumeStream, type UIMessage } from 'ai'
import * as z from 'zod'
import { apiError } from '@/lib/api/error'
import { applyRateLimit } from '@/lib/api/rate-limit'
import { repoLensAgent } from '@/lib/ai/agent'
import { SKILL_ID_SCHEMA } from '@/lib/ai/skills/types'
import type { NextRequest } from 'next/server'

export const maxDuration = 120

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'data']),
  content: z.string().max(100_000).optional(),
}).passthrough()

const changelogRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(200),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1),
  apiKey: z.string().min(1).max(500),
  changelogType: z.enum(['conventional', 'release-notes', 'keep-a-changelog', 'custom']),
  repoContext: z.object({
    name: z.string(),
    description: z.string(),
    structure: z.string().max(200_000),
  }),
  structuralIndex: z.string().max(500_000).optional(),
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  commitData: z.string().max(500_000),
  maxSteps: z.number().int().min(10).max(80).optional(),
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
    const parsed = changelogRequestSchema.safeParse(raw)
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

    const options = {
      mode: 'changelog' as const,
      ...rest,
    }

    return await createAgentUIStreamResponse({
      agent: repoLensAgent,
      uiMessages: messages,
      options,
      // UIMessage[] doesn't match the generic TOOLS-dependent message type
      originalMessages: messages as never[],
      abortSignal: req.signal,
      experimental_transform: smoothStream({ delayInMs: 10 }),
      consumeSseStream: consumeStream,
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
    console.error('Changelog API error:', error instanceof Error ? error.message : 'Unknown error')
    return apiError(
      'CHANGELOG_ERROR',
      'An unexpected error occurred',
      500,
    )
  }
}
