import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/models/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function modelsResponse(): Response {
  return Response.json({
    data: [
      {
        id: 'claude-opus-4-6',
        display_name: 'Claude Opus 4.6',
        max_input_tokens: 200_000,
      },
      {
        id: 'claude-sonnet-4-6',
        display_name: 'Claude Sonnet 4.6',
        max_input_tokens: 1_000_000,
      },
    ],
    first_id: 'claude-opus-4-6',
    has_more: false,
    last_id: 'claude-sonnet-4-6',
  })
}

describe('POST /api/models/anthropic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the models and context limits available to the API key', async () => {
    mockFetch.mockResolvedValueOnce(modelsResponse())

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toEqual([
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        contextLength: 200_000,
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        contextLength: 1_000_000,
      },
    ])
  })

  it('returns the upstream rate-limit status instead of accepting the key as validated', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 429 }))

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(data.error.message).toBe('Failed to fetch models')
  })

  it('returns 400 when API key is missing', async () => {
    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error.message).toBe('API key required')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 400 when API key is an empty string', async () => {
    const response = await POST(createRequest({ apiKey: '' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error.message).toBe('API key required')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 401 when API key is invalid', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 401 }))

    const response = await POST(createRequest({ apiKey: 'sk-ant-invalid' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error.message).toBe('Invalid API key')
  })

  it('preserves a 403 invalid-credential response', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }))

    const response = await POST(createRequest({ apiKey: 'sk-ant-invalid' }))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error.message).toBe('Invalid API key')
  })

  it('returns 500 when fetch throws a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to fetch models')
  })

  it('returns the upstream failure instead of stale hard-coded models', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }))

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to fetch models')
    expect(data.models).toBeUndefined()
  })

  it('lists models with the documented Anthropic authentication headers', async () => {
    mockFetch.mockResolvedValueOnce(modelsResponse())

    await POST(createRequest({ apiKey: 'sk-ant-test-key' }))

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models?limit=1000',
      {
        headers: {
          'x-api-key': 'sk-ant-test-key',
          'anthropic-version': '2023-06-01',
        },
      },
    )
  })

  it('returns 500 when the models response does not match the documented schema', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ data: 'not-an-array' }))

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to fetch models')
  })

  it('rejects an oversized JSON body before calling Anthropic', async () => {
    const response = await POST(createRequest({
      apiKey: 'sk-ant-valid-key',
      padding: 'x'.repeat(5_000),
    }))

    expect(response.status).toBe(413)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
