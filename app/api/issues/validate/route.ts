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
  id: z.string().min(1).max(128),
  ruleId: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  description: z.string().max(4_000),
  severity: z.enum(['critical', 'warning', 'info']),
  category: z.string().min(1).max(100),
  file: z.string().min(1).max(4_096),
  line: z.number().int().positive(),
  column: z.number().int().nonnegative().optional(),
  snippet: z.string().max(128 * 1_024),
  suggestion: z.string().max(4_000).optional(),
  cwe: z.string().max(100).optional(),
  owasp: z.string().max(200).optional(),
  learnMoreUrl: z.string().max(2_048).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  fix: z.string().max(128 * 1_024).optional(),
  fixDescription: z.string().max(4_000).optional(),
  riskScore: z.number().min(0).max(10).optional(),
  cvssVector: z.string().max(256).optional(),
  message: z.string().max(4_000).optional(),
  taintFlow: z.object({
    source: z.string().max(4_000),
    sink: z.string().max(4_000),
    path: z.array(z.string().max(4_096)).max(100),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }).optional(),
}).strict()

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
