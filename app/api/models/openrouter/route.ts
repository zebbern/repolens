import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiKeyRequestSchema } from '@/types/types'

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
      return NextResponse.json({ error: 'API key required' }, { status: 400 })
    }

    // Fetch available models from OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${parsed.data.apiKey}`,
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }

    const data: unknown = await response.json()
    const modelsResult = openRouterModelsResponseSchema.safeParse(data)

    if (!modelsResult.success) {
      return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 })
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
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 })
  }
}
