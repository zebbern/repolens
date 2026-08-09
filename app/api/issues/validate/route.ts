import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import * as z from 'zod'
import { createUntrustedContextMessage } from '@/lib/ai/agent/prompt-context'
import { createAIModel } from '@/lib/ai/providers'
import { aiRequestSchemaError, readBoundedAIRequest } from '@/lib/api/ai-request'
import {
  buildValidationPrompt,
  parseValidationResponse,
  getCodeContext,
  scrubSecrets,
} from '@/lib/code/scanner/ai-validator'
import type { CodeIssue } from '@/lib/code/scanner/types'
import { applyRateLimit } from '@/lib/api/rate-limit'

export const maxDuration = 60

const issueSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  category: z.string(),
  file: z.string().max(4_096),
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
  model: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/),
  apiKey: z.string().min(1).max(500),
})

export async function POST(req: NextRequest) {
  const rateLimited = applyRateLimit(req, { bucket: '/api/issues/validate' })
  if (rateLimited) return rateLimited

  const raw = await readBoundedAIRequest(req)
  if (!raw.success) return raw.response

  const parsed = validateRequestSchema.safeParse(raw.data)
  if (!parsed.success) {
    return aiRequestSchemaError(parsed.error)
  }

  const { issue, fileContent, provider, model: modelId, apiKey } = parsed.data

  try {
    const rawContext = getCodeContext(fileContent, issue.line)
    const context = scrubSecrets(rawContext)
    const scrubbedIssue = { ...issue, snippet: scrubSecrets(issue.snippet) } as CodeIssue
    const { system } = buildValidationPrompt(scrubbedIssue, context)
    const contextMessage = createUntrustedContextMessage([{
      kind: 'pinned-files',
      data: { finding: scrubbedIssue, codeContext: context },
    }])

    const aiModel = createAIModel(provider, modelId, apiKey)

    const { text } = await generateText({
      model: aiModel,
      system,
      messages: [
        contextMessage,
        { role: 'user', content: 'Validate the finding and respond with the required JSON object.' },
      ],
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
