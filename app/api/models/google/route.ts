import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiKeyRequestSchema } from '@/types/types'
import { apiError } from '@/lib/api/error'

const googleModelsResponseSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    displayName: z.string().optional(),
    supportedGenerationMethods: z.array(z.string()).optional(),
    inputTokenLimit: z.number().optional(),
  })).default([]),
})

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json()
    const parsed = apiKeyRequestSchema.safeParse(body)

    if (!parsed.success) {
      return apiError('API_KEY_REQUIRED', 'API key required', 400)
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${parsed.data.apiKey}`
    )

    if (!response.ok) {
      return apiError('INVALID_API_KEY', 'Invalid API key', 401)
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
