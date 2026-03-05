import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as z from 'zod'

// ---------------------------------------------------------------------------
// Schema-level tests (same approach as route-pinned.test.ts)
// ---------------------------------------------------------------------------

const VALID_SYMBOL_KINDS = [
  'function', 'class', 'interface', 'type', 'variable',
  'enum', 'method', 'property',
] as const

const inlineActionSchema = z.object({
  action: z.enum(['explain', 'refactor', 'complexity']),
  symbolCode: z.string().min(1).max(50_000),
  symbolName: z.string().min(1).max(200),
  symbolKind: z.enum(VALID_SYMBOL_KINDS),
  filePath: z.string().min(1).max(500),
  language: z.string().min(1).max(50),
  provider: z.enum(['openai', 'google', 'anthropic', 'openrouter']),
  model: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(500),
})

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    action: 'explain',
    symbolCode: 'function hello() { return 1 }',
    symbolName: 'hello',
    symbolKind: 'function',
    filePath: 'src/hello.ts',
    language: 'typescript',
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-test-key',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests — schema validation
// ---------------------------------------------------------------------------

describe('Inline Actions API — schema validation', () => {
  it('accepts a valid request', () => {
    const result = inlineActionSchema.safeParse(validRequest())
    expect(result.success).toBe(true)
  })

  it('rejects missing action field', () => {
    const { action: _, ...rest } = validRequest()
    expect(inlineActionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects invalid action type (e.g. "find-usages" is not an AI action)', () => {
    const result = inlineActionSchema.safeParse(validRequest({ action: 'find-usages' }))
    expect(result.success).toBe(false)
  })

  it('rejects unknown action string', () => {
    const result = inlineActionSchema.safeParse(validRequest({ action: 'delete' }))
    expect(result.success).toBe(false)
  })

  it('rejects empty symbolCode', () => {
    const result = inlineActionSchema.safeParse(validRequest({ symbolCode: '' }))
    expect(result.success).toBe(false)
  })

  it('rejects symbolCode exceeding 50k chars', () => {
    const result = inlineActionSchema.safeParse(
      validRequest({ symbolCode: 'x'.repeat(50_001) }),
    )
    expect(result.success).toBe(false)
  })

  it('accepts symbolCode at exactly 50k chars', () => {
    const result = inlineActionSchema.safeParse(
      validRequest({ symbolCode: 'x'.repeat(50_000) }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects empty symbolName', () => {
    expect(inlineActionSchema.safeParse(validRequest({ symbolName: '' })).success).toBe(false)
  })

  it('rejects empty symbolKind', () => {
    expect(inlineActionSchema.safeParse(validRequest({ symbolKind: '' })).success).toBe(false)
  })

  it('rejects empty filePath', () => {
    expect(inlineActionSchema.safeParse(validRequest({ filePath: '' })).success).toBe(false)
  })

  it('rejects empty language', () => {
    expect(inlineActionSchema.safeParse(validRequest({ language: '' })).success).toBe(false)
  })

  it('rejects invalid provider', () => {
    expect(
      inlineActionSchema.safeParse(validRequest({ provider: 'mistral' })).success,
    ).toBe(false)
  })

  it.each(['openai', 'google', 'anthropic', 'openrouter'])(
    'accepts valid provider: %s',
    (provider) => {
      expect(
        inlineActionSchema.safeParse(validRequest({ provider })).success,
      ).toBe(true)
    },
  )

  it('rejects empty model', () => {
    expect(inlineActionSchema.safeParse(validRequest({ model: '' })).success).toBe(false)
  })

  it('rejects empty apiKey', () => {
    expect(inlineActionSchema.safeParse(validRequest({ apiKey: '' })).success).toBe(false)
  })

  it('rejects apiKey exceeding 500 chars', () => {
    expect(
      inlineActionSchema.safeParse(validRequest({ apiKey: 'k'.repeat(501) })).success,
    ).toBe(false)
  })

  it('rejects missing required fields', () => {
    expect(inlineActionSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a completely empty body', () => {
    expect(inlineActionSchema.safeParse(undefined).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests — POST handler integration
// ---------------------------------------------------------------------------

// Mock AI SDK and providers before importing the route
const mockStreamText = vi.fn()
const mockCreateAIModel = vi.fn()

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}))

vi.mock('@/lib/ai/providers', () => ({
  createAIModel: (...args: unknown[]) => mockCreateAIModel(...args),
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number, details?: string) => {
    return Response.json(
      { error: { code, message, ...(details !== undefined && { details }) } },
      { status },
    )
  },
}))

import { POST } from '@/app/api/inline-actions/route'

describe('Inline Actions API — POST handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAIModel.mockReturnValue({ id: 'mock-model' })
    mockStreamText.mockReturnValue({
      toTextStreamResponse: () => new Response('streamed output', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    })
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: 'not json!!!',
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_JSON')
  })

  it('returns 422 for missing required fields', async () => {
    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 422 for invalid action type', async () => {
    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: JSON.stringify(validRequest({ action: 'hack' })),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid provider', async () => {
    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: JSON.stringify(validRequest({ provider: 'invalid-provider' })),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('calls createAIModel with correct provider, model, and apiKey', async () => {
    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: JSON.stringify(validRequest({
        provider: 'anthropic',
        model: 'claude-3-opus',
        apiKey: 'sk-ant-key',
      })),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(req)

    expect(mockCreateAIModel).toHaveBeenCalledWith('anthropic', 'claude-3-opus', 'sk-ant-key')
  })

  it('calls streamText with action-specific system prompt', async () => {
    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: JSON.stringify(validRequest({ action: 'complexity' })),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(req)

    expect(mockStreamText).toHaveBeenCalledOnce()
    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.system).toContain('complexity')
    expect(callArgs.messages).toHaveLength(1)
    expect(callArgs.messages[0].role).toBe('user')
  })

  it('returns a streaming response for a valid request', async () => {
    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: JSON.stringify(validRequest()),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('streamed output')
  })

  it('passes abortSignal from request to streamText', async () => {
    const controller = new AbortController()
    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: JSON.stringify(validRequest()),
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })

    await POST(req)

    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.abortSignal).toBeDefined()
  })

  it('returns 500 when streamText throws', async () => {
    mockStreamText.mockImplementation(() => { throw new Error('AI unavailable') })

    const req = new Request('http://localhost/api/inline-actions', {
      method: 'POST',
      body: JSON.stringify(validRequest()),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('AI unavailable')
  })
})
