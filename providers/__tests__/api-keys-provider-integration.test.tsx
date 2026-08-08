import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { APIKeysProvider, useAPIKeys } from '../api-keys-provider'

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'codedoc-api-keys'

function wrapper({ children }: { children: ReactNode }) {
  return <APIKeysProvider>{children}</APIKeysProvider>
}

function makeStoredKeys(overrides: Record<string, Partial<{ key: string; isValid: boolean | null; lastValidated: string | null }>> = {}) {
  return {
    openai: { key: '', isValid: null, lastValidated: null },
    google: { key: '', isValid: null, lastValidated: null },
    anthropic: { key: '', isValid: null, lastValidated: null },
    openrouter: { key: '', isValid: null, lastValidated: null },
    ...overrides,
  }
}

function makeModelsResponse(models: { id: string; name?: string }[]) {
  return {
    ok: true,
    json: () => Promise.resolve({ models }),
  }
}

function makeFailResponse() {
  return {
    ok: false,
    json: () => Promise.resolve({ error: 'Invalid key' }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('APIKeysProvider', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    localStorage.clear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
  })

  // -----------------------------------------------------------------------
  // Async localStorage hydration
  // -----------------------------------------------------------------------

  describe('async localStorage hydration', () => {
    it('loads stored keys after hydration effect runs', async () => {
      const stored = makeStoredKeys({
        openai: { key: 'sk-test-key', isValid: true, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      // Suppress auto-fetch for this test
      globalThis.fetch = vi.fn().mockResolvedValue(makeModelsResponse([{ id: 'm1' }]))

      const { result } = renderHook(() => useAPIKeys(), { wrapper })

      // Keys are loaded via useEffect, so they appear after hydration
      await waitFor(() => {
        expect(result.current.apiKeys.openai.key).toBe('sk-test-key')
      })
      expect(result.current.isHydrated).toBe(true)
    })

    it('uses default empty keys when localStorage has no data', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(makeModelsResponse([]))

      const { result } = renderHook(() => useAPIKeys(), { wrapper })

      // Wait for hydration to complete
      await waitFor(() => {
        expect(result.current.isHydrated).toBe(true)
      })

      expect(result.current.apiKeys.openai.key).toBe('')
      expect(result.current.apiKeys.google.key).toBe('')
      expect(result.current.apiKeys.anthropic.key).toBe('')
      expect(result.current.apiKeys.openrouter.key).toBe('')
    })

    it('uses defaults when localStorage contains invalid JSON', async () => {
      localStorage.setItem(STORAGE_KEY, '{bad json')
      globalThis.fetch = vi.fn().mockResolvedValue(makeModelsResponse([]))

      const { result } = renderHook(() => useAPIKeys(), { wrapper })

      await waitFor(() => {
        expect(result.current.isHydrated).toBe(true)
      })

      expect(result.current.apiKeys.openai.key).toBe('')
    })
  })

  // -----------------------------------------------------------------------
  // Auto-fetch on mount
  // -----------------------------------------------------------------------

  describe('auto-fetch on mount', () => {
    it('fetches models for providers with stored keys', async () => {
      const stored = makeStoredKeys({
        openai: { key: 'sk-openai-key', isValid: null, lastValidated: null },
        anthropic: { key: 'sk-ant-key', isValid: null, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      const mockFetch = vi.fn().mockResolvedValue(
        makeModelsResponse([{ id: 'test-model', name: 'Test Model' }]),
      )
      globalThis.fetch = mockFetch

      renderHook(() => useAPIKeys(), { wrapper })

      // Wait for the auto-fetch effect to fire
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2)
      })

      // Should have been called for openai and anthropic
      const urls = mockFetch.mock.calls.map(call => String(call[0]))
      expect(urls).toContain('/api/models/openai')
      expect(urls).toContain('/api/models/anthropic')
    })

    it('does not fetch for providers without stored keys', async () => {
      const stored = makeStoredKeys({
        openai: { key: 'sk-key', isValid: null, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      const mockFetch = vi.fn().mockResolvedValue(
        makeModelsResponse([{ id: 'gpt-4o' }]),
      )
      globalThis.fetch = mockFetch

      renderHook(() => useAPIKeys(), { wrapper })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1)
      })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toBe('/api/models/openai')
    })

    it('does not fetch when no providers have keys', async () => {
      // Default empty keys — no stored data
      const mockFetch = vi.fn()
      globalThis.fetch = mockFetch

      renderHook(() => useAPIKeys(), { wrapper })

      // Give effects time to run
      await act(async () => {
        await new Promise(r => setTimeout(r, 50))
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('populates models after successful auto-fetch', async () => {
      const stored = makeStoredKeys({
        openai: { key: 'sk-key', isValid: null, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      globalThis.fetch = vi.fn().mockResolvedValue(
        makeModelsResponse([
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        ]),
      )

      const { result } = renderHook(() => useAPIKeys(), { wrapper })

      await waitFor(() => {
        expect(result.current.models.length).toBe(2)
      })

      expect(result.current.models[0].id).toBe('gpt-4o')
      expect(result.current.models[1].id).toBe('gpt-4-turbo')
    })
  })

  // -----------------------------------------------------------------------
  // hasAutoFetched guard
  // -----------------------------------------------------------------------

  describe('hasAutoFetched guard', () => {
    it('does not double-fetch on rerender', async () => {
      const stored = makeStoredKeys({
        openai: { key: 'sk-key', isValid: null, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      const mockFetch = vi.fn().mockResolvedValue(
        makeModelsResponse([{ id: 'gpt-4o' }]),
      )
      globalThis.fetch = mockFetch

      const { rerender } = renderHook(() => useAPIKeys(), { wrapper })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1)
      })

      // Rerender should NOT trigger another fetch
      rerender()

      // Give time for potential duplicate calls
      await act(async () => {
        await new Promise(r => setTimeout(r, 100))
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Fetch failure handling
  // -----------------------------------------------------------------------

  describe('fetch failure handling', () => {
    it('marks key as isValid:false on fetch error response', async () => {
      const stored = makeStoredKeys({
        openai: { key: 'sk-bad-key', isValid: null, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      globalThis.fetch = vi.fn().mockResolvedValue(makeFailResponse())

      const { result } = renderHook(() => useAPIKeys(), { wrapper })

      await waitFor(() => {
        expect(result.current.apiKeys.openai.isValid).toBe(false)
      })
    })

    it('marks key as isValid:false on network error', async () => {
      const stored = makeStoredKeys({
        google: { key: 'AIza-bad-key', isValid: null, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useAPIKeys(), { wrapper })

      await waitFor(() => {
        expect(result.current.apiKeys.google.isValid).toBe(false)
      })
    })

    it('returns empty models list when fetch fails', async () => {
      const stored = makeStoredKeys({
        openai: { key: 'sk-key', isValid: null, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'))

      const { result } = renderHook(() => useAPIKeys(), { wrapper })

      await waitFor(() => {
        expect(result.current.apiKeys.openai.isValid).toBe(false)
      })

      expect(result.current.models).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // Auto-select default model
  // -----------------------------------------------------------------------

  describe('auto-select default model', () => {
    it('auto-selects a model after successful fetch when none is selected', async () => {
      const stored = makeStoredKeys({
        openai: { key: 'sk-key', isValid: null, lastValidated: null },
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      globalThis.fetch = vi.fn().mockResolvedValue(
        makeModelsResponse([{ id: 'gpt-4o', name: 'GPT-4o' }]),
      )

      const { result } = renderHook(() => useAPIKeys(), { wrapper })

      await waitFor(() => {
        expect(result.current.selectedModel).not.toBeNull()
      })

      expect(result.current.selectedModel!.id).toBe('gpt-4o')
    })
  })
})
