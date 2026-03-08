import { describe, it, expect } from 'vitest'
import * as z from 'zod'

/**
 * Duplicate the chat route schema inline (same pattern as route-pinned.test.ts)
 * so we can test schema validation in isolation without mocking the whole route.
 */
const SKILL_ID_SCHEMA = z.string().regex(/^[a-z0-9-]+$/).max(50)

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
  compactionEnabled: z.boolean().optional(),
  activeSkills: z.array(SKILL_ID_SCHEMA).max(10).optional(),
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

describe('Chat API — activeSkills schema validation', () => {
  it('accepts a request without activeSkills (backward compatible)', () => {
    const result = chatRequestSchema.safeParse(validRequest())
    expect(result.success).toBe(true)
  })

  it('accepts a request with valid activeSkills', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({ activeSkills: ['security-audit', 'architecture-review'] }),
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeSkills).toEqual(['security-audit', 'architecture-review'])
    }
  })

  it('accepts activeSkills as an empty array', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({ activeSkills: [] }),
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeSkills).toEqual([])
    }
  })

  it('rejects activeSkills with invalid ID format (uppercase, spaces, special chars)', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({ activeSkills: ['INVALID ID!'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects activeSkills exceeding max length (11+ items)', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `skill-${i}`)
    const result = chatRequestSchema.safeParse(
      validRequest({ activeSkills: tooMany }),
    )
    expect(result.success).toBe(false)
  })

  it('accepts activeSkills at exactly max length (10 items)', () => {
    const maxItems = Array.from({ length: 10 }, (_, i) => `skill-${i}`)
    const result = chatRequestSchema.safeParse(
      validRequest({ activeSkills: maxItems }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects activeSkills with non-array type', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({ activeSkills: 'security-audit' }),
    )
    expect(result.success).toBe(false)
  })

  it('preserves other fields when activeSkills is present', () => {
    const result = chatRequestSchema.safeParse(
      validRequest({
        activeSkills: ['security-audit'],
        pinnedContext: 'some pinned content',
        repoContext: {
          name: 'my-repo',
          description: 'A test repo',
          structure: 'src/\n  app.ts\n',
        },
      }),
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeSkills).toEqual(['security-audit'])
      expect(result.data.pinnedContext).toBe('some pinned content')
      expect(result.data.repoContext?.name).toBe('my-repo')
    }
  })
})
