import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import * as z from 'zod'
import { createAIModel } from '@/lib/ai/providers'
import {
  buildValidationPrompt,
  parseValidationResponse,
  getCodeContext,
  scrubSecrets,
} from '@/lib/code/scanner/ai-validator'
import type { CodeIssue } from '@/lib/code/scanner/types'
import { apiError } from '@/lib/api/error'
import { applyRateLimit } from '@/lib/api/rate-limit'

export const maxDuration = 60

const issueSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  category: z.string(),
  file: z.string(),
  line: z.number(),
  snippet: z.string(),
  suggestion: z.string().optional(),
  cwe: z.string().optional(),
  owasp: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
})

const validateRequestSchema = z.object({
  issue: issueSchema,
  fileContent: z.string().max(500_000),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1),
  apiKey: z.string().min(1).max(500),
})

export async function POST(req: NextRequest) {
  const rateLimited = applyRateLimit(req)
  if (rateLimited) return rateLimited

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiError('INVALID_JSON', 'Invalid JSON body', 400)
  }

  const parsed = validateRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Invalid request',
      400,
      JSON.stringify(parsed.error.flatten().fieldErrors),
    )
  }

  const { issue, fileContent, provider, model: modelId, apiKey } = parsed.data

  try {
    const rawContext = getCodeContext(fileContent, issue.line)
    const context = scrubSecrets(rawContext)
    const scrubbedIssue = { ...issue, snippet: scrubSecrets(issue.snippet) } as CodeIssue
    const { system, user } = buildValidationPrompt(scrubbedIssue, context)

    const aiModel = createAIModel(provider, modelId, apiKey)

    const { text } = await generateText({
      model: aiModel,
      system,
      prompt: user,
      maxOutputTokens: 500,
      temperature: 0.1,
    })

    const result = parseValidationResponse(text, issue.id)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[validate] AI validation failed for issue', issue.id, error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      {
        issueId: issue.id,
        verdict: 'uncertain',
        confidence: 'low',
        reasoning: 'Server-side AI validation failed. Please try again.',
      },
      { status: 200 },
    )
  }
}
