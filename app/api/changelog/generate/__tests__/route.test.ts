import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — set up before importing the route
// ---------------------------------------------------------------------------

const mockCreateAgentUIStreamResponse = vi.fn()

vi.mock('ai', () => ({
  createAgentUIStreamResponse: (...args: unknown[]) => mockCreateAgentUIStreamResponse(...args),
  smoothStream: () => 'smooth-transform',
  consumeStream: vi.fn(),
  ToolLoopAgent: vi.fn(),
}))

vi.mock('@/lib/ai/agent', () => ({
  repoLensAgent: { id: 'mock-agent' },
}))

vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number, details?: string) => {
    return Response.json(
      { error: { code, message, ...(details !== undefined && { details }) } },
      { status },
    )
  },
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: () => null,
}))

import { POST } from '@/app/api/changelog/generate/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messages: [{ role: 'user', content: 'Generate changelog' }],
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-test-key',
    changelogType: 'conventional',
    repoContext: {
      name: 'owner/repo',
      description: 'A test repo',
      structure: 'src/\n  index.ts',
    },
    fromRef: 'v1.0.0',
    toRef: 'v2.0.0',
    commitData: 'abc123 feat: add feature\ndef456 fix: fix bug',
    ...overrides,
  }
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/changelog/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/changelog/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAgentUIStreamResponse.mockReturnValue(
      new Response('stream-data', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/changelog/generate', {
      method: 'POST',
      body: 'not json!!!',
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_JSON')
  })

  it('returns 422 for empty body', async () => {
    const req = makeRequest({})

    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 422 for missing apiKey', async () => {
    const req = makeRequest(validBody({ apiKey: '' }))

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 for missing messages', async () => {
    const req = makeRequest(validBody({ messages: [] }))

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid provider', async () => {
    const req = makeRequest(validBody({ provider: 'mistral' }))

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid changelogType', async () => {
    const req = makeRequest(validBody({ changelogType: 'invalid-type' }))

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 for missing fromRef', async () => {
    const req = makeRequest(validBody({ fromRef: '' }))

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 for missing toRef', async () => {
    const req = makeRequest(validBody({ toRef: '' }))

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('succeeds with valid request and returns streaming response', async () => {
    const req = makeRequest(validBody())

    const res = await POST(req)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('stream-data')
  })

  it('passes changelog options with mode to createAgentUIStreamResponse', async () => {
    const req = makeRequest(validBody({
      provider: 'anthropic',
      model: 'claude-3-opus',
      apiKey: 'sk-ant-key',
      changelogType: 'release-notes',
      fromRef: 'v3.0.0',
      toRef: 'v4.0.0',
    }))

    await POST(req)

    expect(mockCreateAgentUIStreamResponse).toHaveBeenCalledOnce()
    const callArgs = mockCreateAgentUIStreamResponse.mock.calls[0][0]
    expect(callArgs.options).toMatchObject({
      mode: 'changelog',
      provider: 'anthropic',
      model: 'claude-3-opus',
      apiKey: 'sk-ant-key',
      changelogType: 'release-notes',
      fromRef: 'v3.0.0',
      toRef: 'v4.0.0',
    })
  })

  it('passes repoContext in options', async () => {
    const req = makeRequest(validBody({
      repoContext: {
        name: 'my-org/my-repo',
        description: 'My awesome project',
        structure: 'src/\n  main.ts',
      },
    }))

    await POST(req)

    const callArgs = mockCreateAgentUIStreamResponse.mock.calls[0][0]
    expect(callArgs.options.repoContext).toMatchObject({
      name: 'my-org/my-repo',
      description: 'My awesome project',
    })
  })

  it('passes commitData in options', async () => {
    const commitData = 'abc123 feat: add feature\ndef456 fix: fix bug'
    const req = makeRequest(validBody({ commitData }))

    await POST(req)

    const callArgs = mockCreateAgentUIStreamResponse.mock.calls[0][0]
    expect(callArgs.options.commitData).toBe(commitData)
  })

  it('accepts optional maxSteps param', async () => {
    const req = makeRequest(validBody({ maxSteps: 60 }))

    const res = await POST(req)
    expect(res.status).toBe(200)

    const callArgs = mockCreateAgentUIStreamResponse.mock.calls[0][0]
    expect(callArgs.options.maxSteps).toBe(60)
  })

  it('accepts optional structuralIndex param', async () => {
    const req = makeRequest(validBody({ structuralIndex: '{"files": []}' }))

    const res = await POST(req)
    expect(res.status).toBe(200)

    const callArgs = mockCreateAgentUIStreamResponse.mock.calls[0][0]
    expect(callArgs.options.structuralIndex).toBe('{"files": []}')
  })

  it('returns 500 when createAgentUIStreamResponse throws', async () => {
    mockCreateAgentUIStreamResponse.mockImplementation(() => { throw new Error('AI unavailable') })

    const req = makeRequest(validBody())

    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('An unexpected error occurred')
  })

  it('passes abortSignal from request', async () => {
    const controller = new AbortController()
    const req = new NextRequest('http://localhost/api/changelog/generate', {
      method: 'POST',
      body: JSON.stringify(validBody()),
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })

    await POST(req)

    const callArgs = mockCreateAgentUIStreamResponse.mock.calls[0][0]
    expect(callArgs.abortSignal).toBeDefined()
  })

  it('passes the repoLensAgent instance', async () => {
    const req = makeRequest(validBody())

    await POST(req)

    const callArgs = mockCreateAgentUIStreamResponse.mock.calls[0][0]
    expect(callArgs.agent).toEqual({ id: 'mock-agent' })
  })

  it('includes uiMessages in the call', async () => {
    const req = makeRequest(validBody())

    await POST(req)

    const callArgs = mockCreateAgentUIStreamResponse.mock.calls[0][0]
    expect(callArgs.uiMessages).toBeDefined()
  })

  it.each(['openai', 'google', 'anthropic', 'openrouter'])(
    'accepts valid provider: %s',
    async (provider) => {
      const req = makeRequest(validBody({ provider }))
      const res = await POST(req)
      expect(res.status).toBe(200)
    },
  )

  it.each(['conventional', 'release-notes', 'keep-a-changelog', 'custom'])(
    'accepts valid changelog type: %s',
    async (changelogType) => {
      const req = makeRequest(validBody({ changelogType }))
      const res = await POST(req)
      expect(res.status).toBe(200)
    },
  )
})
