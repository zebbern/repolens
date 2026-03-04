import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/models/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/models/google', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns filtered Gemini models for a valid API key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-1.5-pro',
            displayName: 'Gemini 1.5 Pro',
            supportedGenerationMethods: ['generateContent'],
            inputTokenLimit: 2097152,
          },
          {
            name: 'models/gemini-1.5-flash',
            displayName: 'Gemini 1.5 Flash',
            supportedGenerationMethods: ['generateContent'],
            inputTokenLimit: 1048576,
          },
          {
            name: 'models/text-bison',
            displayName: 'Text Bison',
            supportedGenerationMethods: ['generateText'],
          },
          {
            name: 'models/embedding-001',
            displayName: 'Embedding',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      }),
    })

    const response = await POST(createRequest({ apiKey: 'AIvalid-key' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toBeDefined()
    const ids = data.models.map((m: { id: string }) => m.id)
    // Only gemini models with generateContent should be included
    expect(ids).toContain('gemini-1.5-pro')
    expect(ids).toContain('gemini-1.5-flash')
    expect(ids).not.toContain('text-bison')
    expect(ids).not.toContain('embedding-001')
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

    const response = await POST(createRequest({ apiKey: 'bad-key' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error.message).toBe('Invalid API key')
  })

  it('returns 500 when fetch throws an error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))

    const response = await POST(createRequest({ apiKey: 'AIvalid-key' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to fetch models')
  })

  it('returns 500 when upstream response fails Zod validation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: 'not-an-array' }),
    })

    const response = await POST(createRequest({ apiKey: 'AIvalid-key' }))
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

  it('includes contextLength from upstream data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-1.5-pro',
            displayName: 'Gemini 1.5 Pro',
            supportedGenerationMethods: ['generateContent'],
            inputTokenLimit: 2097152,
          },
        ],
      }),
    })

    const response = await POST(createRequest({ apiKey: 'AIvalid-key' }))
    const data = await response.json()

    expect(data.models[0].contextLength).toBe(2097152)
  })

  it('handles upstream returning empty models array gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    })

    const response = await POST(createRequest({ apiKey: 'AIvalid-key' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toEqual([])
  })

  it('sorts models with gemini-1.5-pro first', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-1.5-flash',
            displayName: 'Gemini 1.5 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-1.5-pro',
            displayName: 'Gemini 1.5 Pro',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }),
    })

    const response = await POST(createRequest({ apiKey: 'AIvalid-key' }))
    const data = await response.json()

    const ids = data.models.map((m: { id: string }) => m.id)
    expect(ids[0]).toBe('gemini-1.5-pro')
    expect(ids[1]).toBe('gemini-1.5-flash')
  })
})
