import { createAgentUIStreamResponse, consumeStream, smoothStream, type UIMessage } from 'ai'
import * as z from 'zod'
import { repoLensAgent } from '@/lib/ai/agent'
import { AGENT_ROUTE_TOOLS } from '@/lib/ai/agent/route-tools'
import { SKILL_ID_SCHEMA } from '@/lib/ai/skills/types'
import { aiRequestSchemaError, readBoundedAIRequest, validateBoundedUIMessages } from '@/lib/api/ai-request'
import { apiError } from '@/lib/api/error'
import { applyRateLimit } from '@/lib/api/rate-limit'
import type { NextRequest } from 'next/server'

export const maxDuration = 120

const docsRequestSchema = z.object({
  messages: z.unknown(),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/),
  apiKey: z.string().min(1).max(500),
  docType: z.enum(['architecture', 'setup', 'api-reference', 'file-explanation', 'onboarding', 'custom']),
  repoContext: z.object({
    name: z.string().trim().min(1).max(256),
    description: z.string().max(2_000),
    structure: z.string().max(200_000),
  }),
  structuralIndex: z.string().max(500_000).optional(),
  targetFile: z.string().max(4_096).nullish(),
  maxSteps: z.number().int().min(10).max(80).optional(),
  activeSkills: z.array(SKILL_ID_SCHEMA).max(10).optional(),
})

export async function POST(req: NextRequest) {
  const rateLimited = applyRateLimit(req, { bucket: '/api/docs/generate', limit: 10, windowMs: 60_000 })
  if (rateLimited) return rateLimited

  const raw = await readBoundedAIRequest(req)
  if (!raw.success) return raw.response

  try {
    const parsed = docsRequestSchema.safeParse(raw.data)
    if (!parsed.success) {
      return aiRequestSchemaError(parsed.error)
    }
    const { messages: rawMessages, ...rest } = parsed.data
    const validatedMessages = await validateBoundedUIMessages(rawMessages, AGENT_ROUTE_TOOLS.docs)
    if (!validatedMessages.success) return validatedMessages.response
    const messages = validatedMessages.data as UIMessage[]

    return await createAgentUIStreamResponse({
      agent: repoLensAgent,
      uiMessages: messages,
      options: { mode: 'docs' as const, ...rest },
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
    console.error('Docs API error:', error instanceof Error ? error.message : 'Unknown error')
    return apiError(
      'DOCS_ERROR',
      'An unexpected error occurred',
      500,
    )
  }
}
