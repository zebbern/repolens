import { describe, it, expect } from 'vitest'
import * as z from 'zod'

/**
 * Extract the Zod schema from the route definition to test it in isolation.
 * This avoids having to mock the entire Next.js / AI SDK request pipeline.
 */
const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'data']),
  content: z.string().max(100_000).optional(),
}).passthrough()

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(200),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1),
  apiKey: z.string().min(1).max(500),
  repoContext: z.object({
    name: z.string(),
    description: z.string(),
    structure: z.string().max(200_000),
  }).optional(),
  structuralIndex: z.string().max(500_000).optional(),
  pinnedContext: z.string().max(200_000).optional(),
  maxSteps: z.number().int().min(10).max(100).optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-test-key',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Chat API — pinnedContext schema validation', () => {
  it('accepts a request without pinnedContext (backward compatible)', () => {
    const result = chatRequestSchema.safeParse(validRequest())
    expect(result.success).toBe(true)
  })

  it('accepts a request with pinnedContext string', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({ pinnedContext: '### `src/utils.ts`\n```ts\nconst x = 1\n```' }),
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pinnedContext).toContain('src/utils.ts')
    }
  })

  it('accepts an empty string for pinnedContext', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({ pinnedContext: '' }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects pinnedContext exceeding 200KB', () => {
    const oversizedContent = 'x'.repeat(200_001)
    const result = chatRequestSchema.safeParse(
      validRequest({ pinnedContext: oversizedContent }),
    )
    expect(result.success).toBe(false)
  })

  it('accepts pinnedContext at exactly 200KB', () => {
    const maxContent = 'x'.repeat(200_000)
    const result = chatRequestSchema.safeParse(
      validRequest({ pinnedContext: maxContent }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects pinnedContext with non-string type', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({ pinnedContext: 12345 }),
    )
    expect(result.success).toBe(false)
  })

  it('preserves other fields when pinnedContext is present', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({
        pinnedContext: 'pinned files content',
        repoContext: {
          name: 'my-repo',
          description: 'A test repo',
          structure: 'src/\n  app.ts\n',
        },
        structuralIndex: '{"files": []}',
      }),
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pinnedContext).toBe('pinned files content')
      expect(result.data.repoContext?.name).toBe('my-repo')
      expect(result.data.structuralIndex).toBe('{"files": []}')
    }
  })
})
