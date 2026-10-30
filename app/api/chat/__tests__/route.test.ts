import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — set up before importing the route. Only the AI SDK stream factory,
// the agent and the rate limiter are replaced; schema parsing, the bounded
// request reader and UI-message validation are the real implementations.
// ---------------------------------------------------------------------------

const mockCreateAgentUIStreamResponse = vi.fn()
const mockApplyRateLimit = vi.fn()

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    createAgentUIStreamResponse: (...args: unknown[]) => mockCreateAgentUIStreamResponse(...args),
    smoothStream: () => 'smooth-transform',
  }
})

vi.mock('@/lib/ai/agent', () => ({ repoLensAgent: { id: 'chat-agent' } }))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: (...args: unknown[]) => mockApplyRateLimit(...args),
}))

import { POST } from '@/app/api/chat/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MESSAGES = [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'Explain the repo' }] }]

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messages: MESSAGES,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    apiKey: 'sk-test-key',
    ...overrides,
  }
}

function makeRequest(body: unknown, init: { signal?: AbortSignal } = {}): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    signal: init.signal,
  })
}

/** The single options object the route passed to createAgentUIStreamResponse. */
function agentCall(): Record<string, unknown> {
  expect(mockCreateAgentUIStreamResponse).toHaveBeenCalledTimes(1)
  return mockCreateAgentUIStreamResponse.mock.calls[0][0] as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyRateLimit.mockReturnValue(null)
    mockCreateAgentUIStreamResponse.mockReturnValue(
      new Response('stream-data', { headers: { 'Content-Type': 'text/event-stream' } }),
    )
  })

  describe('agent invocation', () => {
    it('streams the agent response for a valid request', async () => {
      const res = await POST(makeRequest(validBody()))

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('text/event-stream')
      await expect(res.text()).resolves.toBe('stream-data')
    })

    it('runs the shared agent in chat mode with the validated messages', async () => {
      await POST(makeRequest(validBody()))

      const call = agentCall()
      expect(call.agent).toEqual({ id: 'chat-agent' })
      expect(call.uiMessages).toEqual(MESSAGES)
      expect(call.originalMessages).toEqual(MESSAGES)
      expect(call.experimental_transform).toBe('smooth-transform')
    })

    it('forwards every chat option except the messages to the agent', async () => {
      const body = validBody({
        repoContext: { name: 'owner/repo', description: 'A repo', structure: 'src/\n  index.ts' },
        structuralIndex: 'index',
        pinnedContext: '// pinned file',
        maxSteps: 25,
        activeSkills: ['security-audit'],
      })

      await POST(makeRequest(body))

      const expected = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'messages'))
      expect(agentCall().options).toEqual({ mode: 'chat', ...expected })
    })

    it('ties the agent run to the request signal so a disconnect aborts it', async () => {
      const controller = new AbortController()
      const req = makeRequest(validBody(), { signal: controller.signal })

      await POST(req)

      const signal = agentCall().abortSignal as AbortSignal
      expect(signal.aborted).toBe(false)
      controller.abort()
      expect(signal.aborted).toBe(true)
    })

    it('reports token usage and the model on the finish part only', async () => {
      await POST(makeRequest(validBody()))
      const messageMetadata = agentCall().messageMetadata as (input: { part: unknown }) => unknown

      expect(messageMetadata({
        part: { type: 'finish', totalUsage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 } },
      })).toEqual({ usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 }, model: 'claude-opus-5-5' })
      expect(messageMetadata({ part: { type: 'finish', totalUsage: {} } })).toEqual({
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model: 'claude-opus-5-5',
      })
      expect(messageMetadata({ part: { type: 'text-delta' } })).toBeUndefined()
    })
  })

  describe('rate limiting', () => {
    it('applies the chat bucket (10 requests per minute)', async () => {
      await POST(makeRequest(validBody()))

      expect(mockApplyRateLimit).toHaveBeenCalledWith(expect.any(Request), {
        bucket: '/api/chat', limit: 10, windowMs: 60_000,
      })
    })

    it('returns the limiter response without reading the body or invoking the agent', async () => {
      const limited = Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })
      mockApplyRateLimit.mockReturnValue(limited)
      const req = makeRequest(validBody())

      const res = await POST(req)

      expect(res).toBe(limited)
      expect(req.bodyUsed).toBe(false)
      expect(mockCreateAgentUIStreamResponse).not.toHaveBeenCalled()
    })
  })

  describe('request validation', () => {
    it.each([
      ['an unknown provider', { provider: 'mistral' }],
      ['a model id with spaces', { model: 'gpt 4o' }],
      ['a model id starting with a separator', { model: '/etc/passwd' }],
      ['a missing API key', { apiKey: '' }],
      ['maxSteps below 10', { maxSteps: 5 }],
      ['maxSteps above 100', { maxSteps: 101 }],
      ['a non-integer maxSteps', { maxSteps: 12.5 }],
      ['a skill id with uppercase, spaces or punctuation', { activeSkills: ['Security Audit!'] }],
      ['activeSkills that is not an array', { activeSkills: 'security-audit' }],
      ['pinnedContext that is not a string', { pinnedContext: 42 }],
      ['a repository name that is only whitespace', { repoContext: { name: '   ', description: '', structure: '' } }],
    ])('rejects %s with 422 before invoking the agent', async (_name, overrides) => {
      const res = await POST(makeRequest(validBody(overrides)))

      expect(res.status).toBe(422)
      await expect(res.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
      expect(mockCreateAgentUIStreamResponse).not.toHaveBeenCalled()
    })

    it.each([
      ['pinnedContext over 200 KB', { pinnedContext: 'x'.repeat(200_001) }],
      ['more than 10 active skills', { activeSkills: Array.from({ length: 11 }, (_, i) => `skill-${i}`) }],
    ])('rejects %s with 413 before invoking the agent', async (_name, overrides) => {
      const res = await POST(makeRequest(validBody(overrides)))

      expect(res.status).toBe(413)
      expect(mockCreateAgentUIStreamResponse).not.toHaveBeenCalled()
    })

    it.each([
      ['pinnedContext of exactly 200 KB', { pinnedContext: 'x'.repeat(200_000) }],
      ['an empty pinnedContext', { pinnedContext: '' }],
      ['exactly 10 active skills', { activeSkills: Array.from({ length: 10 }, (_, i) => `skill-${i}`) }],
      ['an empty activeSkills list', { activeSkills: [] }],
    ])('accepts %s', async (_name, overrides) => {
      const res = await POST(makeRequest(validBody(overrides)))

      expect(res.status).toBe(200)
      expect(mockCreateAgentUIStreamResponse).toHaveBeenCalledTimes(1)
    })
  })

  describe('failures', () => {
    it('returns a generic 500 and logs only the error message when the agent throws', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockCreateAgentUIStreamResponse.mockImplementation(() => {
        throw new Error('provider exploded: sk-secret-upstream-detail')
      })

      const res = await POST(makeRequest(validBody()))
      const body = await res.text()

      expect(res.status).toBe(500)
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'CHAT_ERROR', message: 'An unexpected error occurred' } })
      expect(body).not.toContain('sk-secret-upstream-detail')
      expect(consoleError).toHaveBeenCalledWith('Chat API error:', 'provider exploded: sk-secret-upstream-detail')
      consoleError.mockRestore()
    })

    it('never sends the API key back in an error response', async () => {
      const res = await POST(makeRequest(validBody({ provider: 'mistral', apiKey: 'sk-must-not-echo' })))

      expect(res.status).toBe(422)
      await expect(res.text()).resolves.not.toContain('sk-must-not-echo')
    })
  })
})
