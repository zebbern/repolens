import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/models/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/models/openai', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns filtered and sorted chat models for a valid API key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o-2024-05-13' },
          { id: 'gpt-3.5-turbo' },
          { id: 'gpt-4-turbo-preview' },
          { id: 'gpt-4-vision-preview' },
          { id: 'dall-e-3' },
          { id: 'gpt-4o-realtime' },
          { id: 'gpt-4-instruct' },
          { id: 'gpt-4o-audio' },
        ],
      }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toBeDefined()
    // Only chat models should be included (no vision, instruct, realtime, audio, or non-gpt)
    const ids = data.models.map((m: { id: string }) => m.id)
    expect(ids).toContain('gpt-4o-2024-05-13')
    expect(ids).toContain('gpt-3.5-turbo')
    expect(ids).toContain('gpt-4-turbo-preview')
    expect(ids).not.toContain('gpt-4-vision-preview')
    expect(ids).not.toContain('dall-e-3')
    expect(ids).not.toContain('gpt-4o-realtime')
    expect(ids).not.toContain('gpt-4-instruct')
    expect(ids).not.toContain('gpt-4o-audio')
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

    const response = await POST(createRequest({ apiKey: 'sk-invalid' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error.message).toBe('Invalid API key')
  })

  it('returns 500 when fetch throws an error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))

    const response = await POST(createRequest({ apiKey: 'sk-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to fetch models')
  })

  it('returns 500 when upstream response fails Zod validation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: 'not-an-array' }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-valid-key' }))
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

  it('sorts models with gpt-4o first, then gpt-4-turbo, then gpt-4, then gpt-3.5', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-3.5-turbo' },
          { id: 'gpt-4' },
          { id: 'gpt-4o' },
          { id: 'gpt-4-turbo' },
        ],
      }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-valid-key' }))
    const data = await response.json()

    const ids = data.models.map((m: { id: string }) => m.id)
    expect(ids).toEqual(['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'])
  })

  it('formats model names correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4-turbo-preview' },
        ],
      }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-valid-key' }))
    const data = await response.json()

    expect(data.models[0].name).toBe('GPT-4 Turbo Preview')
  })

  it('handles upstream returning empty data array gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    })

    const response = await POST(createRequest({ apiKey: 'sk-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toEqual([])
  })
})
