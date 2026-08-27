import { NextResponse } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/api/error'
import {
  MAX_API_KEY_REQUEST_BODY_BYTES,
  readBoundedJsonBody,
} from '@/lib/api/json-body'
import { applyRateLimit } from '@/lib/api/rate-limit'
import { apiKeyRequestSchema } from '@/types/types'

const anthropicModelsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    display_name: z.string(),
    max_input_tokens: z.number().nonnegative().nullable().optional(),
  })).default([]),
})

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimited = applyRateLimit(request, { bucket: '/api/models/anthropic' })
  if (rateLimited) return rateLimited

  try {
    const body = await readBoundedJsonBody(request, MAX_API_KEY_REQUEST_BODY_BYTES)
    if (!body.success) return body.response

    const parsed = apiKeyRequestSchema.safeParse(body.data)
    if (!parsed.success) {
      return apiError('API_KEY_REQUIRED', 'API key required', 400)
    }

    const response = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: {
        'x-api-key': parsed.data.apiKey,
        'anthropic-version': '2023-06-01',
      },
    })

    if (response.status === 401 || response.status === 403) {
      return apiError('INVALID_API_KEY', 'Invalid API key', response.status)
    }
    if (!response.ok) {
      return apiError('MODELS_FETCH_ERROR', 'Failed to fetch models', response.status)
    }

    const data: unknown = await response.json()
    const modelsResult = anthropicModelsResponseSchema.safeParse(data)
    if (!modelsResult.success) {
      return apiError('MODELS_PARSE_ERROR', 'Failed to fetch models', 500)
    }

    const models = modelsResult.data.data.map((model) => ({
      id: model.id,
      name: model.display_name,
      contextLength: model.max_input_tokens ?? undefined,
    }))

    return NextResponse.json({ models })
  } catch (error) {
    console.error('[models/anthropic] Failed to fetch models:', error instanceof Error ? error.message : 'Unknown error')
    return apiError('MODELS_FETCH_ERROR', 'Failed to fetch models', 500)
  }
}
