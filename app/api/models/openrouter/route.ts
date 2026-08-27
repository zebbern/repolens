import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiKeyRequestSchema } from '@/types/types'
import { apiError } from '@/lib/api/error'
import {
  MAX_API_KEY_REQUEST_BODY_BYTES,
  readBoundedJsonBody,
} from '@/lib/api/json-body'
import { applyRateLimit } from '@/lib/api/rate-limit'

const openRouterModelsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    context_length: z.number().optional(),
    pricing: z.object({
      prompt: z.string(),
    }).optional(),
  })).default([]),
})

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimited = applyRateLimit(request, { bucket: '/api/models/openrouter' })
  if (rateLimited) return rateLimited

  try {
    const body = await readBoundedJsonBody(request, MAX_API_KEY_REQUEST_BODY_BYTES)
    if (!body.success) return body.response

    const parsed = apiKeyRequestSchema.safeParse(body.data)

    if (!parsed.success) {
      return apiError('API_KEY_REQUIRED', 'API key required', 400)
    }

    // This user-scoped catalog authenticates the key and returns its available models.
    const response = await fetch('https://openrouter.ai/api/v1/models/user', {
      headers: {
        'Authorization': `Bearer ${parsed.data.apiKey}`,
      },
    })

    if (response.status === 401 || response.status === 403) {
      return apiError('INVALID_API_KEY', 'Invalid API key', response.status)
    }
    if (!response.ok) {
      return apiError('MODELS_FETCH_ERROR', 'Failed to fetch models', response.status)
    }

    const data: unknown = await response.json()
    const modelsResult = openRouterModelsResponseSchema.safeParse(data)

    if (!modelsResult.success) {
      return apiError('MODELS_PARSE_ERROR', 'Failed to fetch models', 500)
    }

    // Filter and format models
    const models = modelsResult.data.data
      .filter((model) => 
        // Filter out deprecated or restricted models
        !model.id.includes(':free') || model.pricing?.prompt === '0'
      )
      .slice(0, 50) // Limit to 50 most relevant models
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        contextLength: model.context_length,
      }))

    return NextResponse.json({ models })
  } catch (error) {
    console.error('[models/openrouter] Failed to fetch models:', error instanceof Error ? error.message : 'Unknown error')
    return apiError('MODELS_FETCH_ERROR', 'Failed to fetch models', 500)
  }
}
