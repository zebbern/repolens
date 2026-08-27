import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/models/openrouter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/models/openrouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns formatted models for a valid API key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'openai/gpt-4', name: 'GPT-4', context_length: 8192 },
          { id: 'anthropic/claude-3', name: 'Claude 3', context_length: 200000 },
        ],
      }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-valid' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toHaveLength(2)
    expect(data.models[0]).toEqual({
      id: 'openai/gpt-4',
      name: 'GPT-4',
      contextLength: 8192,
    })
    expect(data.models[1]).toEqual({
      id: 'anthropic/claude-3',
      name: 'Claude 3',
      contextLength: 200000,
    })
  })

  it('returns 400 when API key is missing', async () => {
    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error.message).toBe('API key required')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 401 when API key is invalid', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-bad' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error.message).toBe('Invalid API key')
  })

  it('rejects bogus credentials even though the public model catalog is accessible', async () => {
    mockFetch.mockImplementationOnce(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/models/user')) {
        return {
          ok: false,
          status: 401,
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'public/model', name: 'Public Model' }],
        }),
      }
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-bogus' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error.code).toBe('INVALID_API_KEY')
  })

  it('preserves a 403 invalid-credential response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-bad' }))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error.message).toBe('Invalid API key')
  })

  it('propagates an upstream server error instead of reporting invalid credentials', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-valid' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to fetch models')
  })

  it('preserves rate-limit failures as transient model-fetch errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-valid' }))
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(data.error.code).toBe('MODELS_FETCH_ERROR')
  })

  it('returns 500 when fetch throws an error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

    const response = await POST(createRequest({ apiKey: 'sk-or-valid' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to fetch models')
  })

  it('returns 500 when upstream response fails Zod validation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: 'not-an-array' }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-valid' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to fetch models')
  })

  it('returns 400 when API key is an empty string', async () => {
    const response = await POST(createRequest({ apiKey: '' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error.message).toBe('API key required')
  })

  it('rejects an oversized JSON body before calling OpenRouter', async () => {
    const response = await POST(createRequest({
      apiKey: 'sk-or-valid',
      padding: 'x'.repeat(5_000),
    }))

    expect(response.status).toBe(413)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('limits results to 50 models', async () => {
    const manyModels = Array.from({ length: 100 }, (_, i) => ({
      id: `model-${i}`,
      name: `Model ${i}`,
      context_length: 4096,
    }))

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: manyModels }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-valid' }))
    const data = await response.json()

    expect(data.models.length).toBeLessThanOrEqual(50)
  })

  it('uses model id as name when name is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'some/model-without-name', context_length: 4096 },
        ],
      }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-valid' }))
    const data = await response.json()

    expect(data.models[0].name).toBe('some/model-without-name')
  })

  it('handles upstream returning empty data array gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-or-valid' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toEqual([])
  })
})
