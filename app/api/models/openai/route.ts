import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiKeyRequestSchema } from '@/types/types'
import { apiError } from '@/lib/api/error'
import {
  MAX_API_KEY_REQUEST_BODY_BYTES,
  readBoundedJsonBody,
} from '@/lib/api/json-body'
import { applyRateLimit } from '@/lib/api/rate-limit'

const openAIModelsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
  })).default([]),
})

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimited = applyRateLimit(request, { bucket: '/api/models/openai' })
  if (rateLimited) return rateLimited

  try {
    const body = await readBoundedJsonBody(request, MAX_API_KEY_REQUEST_BODY_BYTES)
    if (!body.success) return body.response

    const parsed = apiKeyRequestSchema.safeParse(body.data)

    if (!parsed.success) {
      return apiError('API_KEY_REQUIRED', 'API key required', 400)
    }

    const response = await fetch('https://api.openai.com/v1/models', {
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
    const modelsResult = openAIModelsResponseSchema.safeParse(data)

    if (!modelsResult.success) {
      return apiError('MODELS_PARSE_ERROR', 'Failed to fetch models', 500)
    }

    // Filter to only include chat models
    const chatModels = modelsResult.data.data
      .filter((model) => 
        model.id.includes('gpt') && 
        !model.id.includes('instruct') &&
        !model.id.includes('vision') &&
        !model.id.includes('realtime') &&
        !model.id.includes('audio')
      )
      .map((model) => ({
        id: model.id,
        name: formatModelName(model.id),
      }))
      .sort((a, b) => {
        // Prioritize newer models
        const order = ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5']
        const aIndex = order.findIndex(o => a.id.includes(o))
        const bIndex = order.findIndex(o => b.id.includes(o))
        return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex)
      })

    return NextResponse.json({ models: chatModels })
  } catch (error) {
    console.error('[models/openai] Failed to fetch models:', error instanceof Error ? error.message : 'Unknown error')
    return apiError('MODELS_FETCH_ERROR', 'Failed to fetch models', 500)
  }
}

function formatModelName(id: string): string {
  return id
    .replace('gpt-', 'GPT-')
    .replace('-turbo', ' Turbo')
    .replace('-preview', ' Preview')
}
