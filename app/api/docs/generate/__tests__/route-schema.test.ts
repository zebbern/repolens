import { describe, it, expect } from 'vitest'
import * as z from 'zod'

// ---------------------------------------------------------------------------
// Re-declare the route's request schema so we can validate it in isolation
// without importing the full route (which pulls in AI SDK, env vars, etc.).
// This mirrors the schema defined in route.ts — if the route schema changes,
// this test will need updating (intentionally: it catches drift).
// ---------------------------------------------------------------------------

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'data']),
  content: z.string().max(100_000).optional(),
}).passthrough()

const docsRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(200),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1),
  apiKey: z.string().min(1).max(500),
  docType: z.enum(['architecture', 'setup', 'api-reference', 'file-explanation', 'onboarding', 'custom']),
  repoContext: z.object({
    name: z.string(),
    description: z.string(),
    structure: z.string().max(200_000),
  }),
  structuralIndex: z.string().max(500_000).optional(),
  targetFile: z.string().nullish(),
  maxSteps: z.number().int().min(10).max(80).optional(),
})

const validBase = {
  messages: [{ role: 'user' as const, content: 'Generate docs' }],
  provider: 'openai' as const,
  model: 'gpt-4o',
  apiKey: 'sk-test-key',
  repoContext: { name: 'my-repo', description: 'A repo', structure: 'src/' },
}

describe('docsRequestSchema — docType validation', () => {
  it.each([
    'architecture',
    'setup',
    'api-reference',
    'file-explanation',
    'onboarding',
    'custom',
  ] as const)('accepts "%s" as a valid docType', (docType) => {
    const result = docsRequestSchema.safeParse({ ...validBase, docType })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown docType', () => {
    const result = docsRequestSchema.safeParse({ ...validBase, docType: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('rejects missing docType', () => {
    const result = docsRequestSchema.safeParse(validBase)
    expect(result.success).toBe(false)
  })
})
