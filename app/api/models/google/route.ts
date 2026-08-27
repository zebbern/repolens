import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiKeyRequestSchema } from '@/types/types'
import { apiError } from '@/lib/api/error'
import {
  MAX_API_KEY_REQUEST_BODY_BYTES,
  readBoundedJsonBody,
} from '@/lib/api/json-body'
import { applyRateLimit } from '@/lib/api/rate-limit'

const googleModelsResponseSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    displayName: z.string().optional(),
    supportedGenerationMethods: z.array(z.string()).optional(),
    inputTokenLimit: z.number().optional(),
  })).default([]),
})

const googleErrorResponseSchema = z.object({
  error: z.object({
    details: z.array(z.object({
      reason: z.string().optional(),
    })).optional(),
  }),
})

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimited = applyRateLimit(request, { bucket: '/api/models/google' })
  if (rateLimited) return rateLimited

  try {
    const body = await readBoundedJsonBody(request, MAX_API_KEY_REQUEST_BODY_BYTES)
    if (!body.success) return body.response

    const parsed = apiKeyRequestSchema.safeParse(body.data)

    if (!parsed.success) {
      return apiError('API_KEY_REQUIRED', 'API key required', 400)
    }

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      { headers: { 'x-goog-api-key': parsed.data.apiKey } },
    )

    const hasInvalidKeyStatus = response.status === 401 || response.status === 403
    const hasInvalidKeyReason = response.status === 400
      && await response.json()
        .then((data: unknown) => {
          const result = googleErrorResponseSchema.safeParse(data)
          return result.success
            && result.data.error.details?.some(detail => detail.reason === 'API_KEY_INVALID') === true
        })
        .catch(() => false)

    if (hasInvalidKeyStatus || hasInvalidKeyReason) {
      return apiError('INVALID_API_KEY', 'Invalid API key', 401)
    }
    if (!response.ok) {
      return apiError('MODELS_FETCH_ERROR', 'Failed to fetch models', response.status)
    }

    const data: unknown = await response.json()
    const modelsResult = googleModelsResponseSchema.safeParse(data)

    if (!modelsResult.success) {
      return apiError('MODELS_PARSE_ERROR', 'Failed to fetch models', 500)
    }

    // Filter to only include Gemini models that support generateContent
    const geminiModels = modelsResult.data.models
      .filter((model) => 
        model.name.includes('gemini') &&
        model.supportedGenerationMethods?.includes('generateContent')
      )
      .map((model) => ({
        id: model.name.replace('models/', ''),
        name: formatModelName(model.displayName ?? model.name),
        contextLength: model.inputTokenLimit,
      }))
      .sort((a, b) => {
        // Prioritize newest models first
        const order = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro']
        const aIndex = order.findIndex(o => a.id.includes(o))
        const bIndex = order.findIndex(o => b.id.includes(o))
        return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex)
      })

    return NextResponse.json({ models: geminiModels })
  } catch (error) {
    console.error('[models/google] Failed to fetch models:', error instanceof Error ? error.message : 'Unknown error')
    return apiError('MODELS_FETCH_ERROR', 'Failed to fetch models', 500)
  }
}

function formatModelName(name: string): string {
  return name
    .replace('models/', '')
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
