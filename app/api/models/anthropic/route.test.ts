import { describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('POST /api/models/anthropic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns known Anthropic models when API key is valid (200 response)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    })

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toBeDefined()
    expect(data.models.length).toBe(3)

    const ids = data.models.map((m: { id: string }) => m.id)
    expect(ids).toContain('claude-sonnet-4-20250514')
    expect(ids).toContain('claude-opus-4-20250514')
    expect(ids).toContain('claude-3-haiku-20240307')
  })

  it('returns known models when rate-limited (429 response)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    })

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toBeDefined()
    expect(data.models.length).toBe(3)
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
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    })

    const response = await POST(createRequest({ apiKey: 'sk-ant-invalid' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error.message).toBe('Invalid API key')
  })

  it('returns 500 when fetch throws a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error.message).toBe('Failed to validate key')
  })

  it('returns models for other non-401 error statuses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.models).toBeDefined()
    expect(data.models.length).toBe(3)
  })

  it('sends correct headers and body to Anthropic API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    })

    await POST(createRequest({ apiKey: 'sk-ant-test-key' }))

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sk-ant-test-key',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      }),
    )
  })

  it('includes contextLength in each returned model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    })

    const response = await POST(createRequest({ apiKey: 'sk-ant-valid-key' }))
    const data = await response.json()

    for (const model of data.models) {
      expect(model).toHaveProperty('contextLength', 200000)
      expect(model).toHaveProperty('name')
      expect(model).toHaveProperty('id')
    }
  })
})
