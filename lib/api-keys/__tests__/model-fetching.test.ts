import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchProviderModels } from '../model-fetching'

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// fetchProviderModels
// ---------------------------------------------------------------------------

describe('fetchProviderModels', () => {
  it('sends a POST request with the correct URL and body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    })

    await fetchProviderModels('openai', 'sk-test-key')

    expect(mockFetch).toHaveBeenCalledWith('/api/models/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-test-key' }),
    })
  })

  it('returns parsed models on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { id: 'gpt-4o', name: 'GPT-4o', contextLength: 128000 },
          { id: 'gpt-3.5-turbo', contextLength: 16384 },
        ],
      }),
    })

    const result = await fetchProviderModels('openai', 'sk-key')
    expect(result.isValid).toBe(true)
    expect(result.models).toHaveLength(2)
    expect(result.models[0]).toEqual({
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      contextLength: 128000,
    })
  })

  it('uses model id as name when name is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ id: 'model-only-id' }],
      }),
    })

    const result = await fetchProviderModels('anthropic', 'sk-ant-key')
    expect(result.models[0].name).toBe('model-only-id')
  })

  it('sets provider on each returned model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ id: 'gemini-pro', name: 'Gemini Pro' }],
      }),
    })

    const result = await fetchProviderModels('google', 'AI-key')
    expect(result.models[0].provider).toBe('google')
  })

  it('returns empty models and isValid=false on a 401 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    })

    const result = await fetchProviderModels('openai', 'bad-key')
    expect(result.models).toEqual([])
    expect(result.isValid).toBe(false)
  })

  it('returns empty models and isValid=false on a 403 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    })

    const result = await fetchProviderModels('openai', 'bad-key')
    expect(result.models).toEqual([])
    expect(result.isValid).toBe(false)
  })

  it.each([429, 500, 503])('rejects a transient HTTP %s response without classifying the key as invalid', async (status) => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
    })

    await expect(fetchProviderModels('openai', 'sk-key')).rejects.toThrow(String(status))
  })

  it('treats a successful empty models array as valid credentials', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    })

    const result = await fetchProviderModels('openai', 'sk-key')
    expect(result.models).toEqual([])
    expect(result.isValid).toBe(true)
  })

  it('treats a successful response without a models field as valid credentials', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    const result = await fetchProviderModels('openai', 'sk-key')
    expect(result.models).toEqual([])
    expect(result.isValid).toBe(true)
  })

  it('propagates fetch errors (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(fetchProviderModels('openai', 'sk-key')).rejects.toThrow('Network error')
  })
})
