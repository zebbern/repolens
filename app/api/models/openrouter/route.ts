import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiKeyRequestSchema } from '@/types/types'
import { apiError } from '@/lib/api/error'

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
  try {
    const body: unknown = await request.json()
    const parsed = apiKeyRequestSchema.safeParse(body)

    if (!parsed.success) {
      return apiError('API_KEY_REQUIRED', 'API key required', 400)
    }

    // Fetch available models from OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${parsed.data.apiKey}`,
      },
    })

    if (!response.ok) {
      return apiError('INVALID_API_KEY', 'Invalid API key', 401)
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
    console.error('[models/openrouter] Failed to fetch models:', error)
    return apiError('MODELS_FETCH_ERROR', 'Failed to fetch models', 500)
  }
}
