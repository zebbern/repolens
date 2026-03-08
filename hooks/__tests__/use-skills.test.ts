import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// We need to reset the module-level cache between tests.
// Use vi.hoisted to declare mock fn before vi.mock.
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mockFetch.mockReset()
  globalThis.fetch = mockFetch
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(id: string) {
  return {
    id,
    name: `Skill ${id}`,
    description: `Description for ${id}`,
    trigger: `Use when ${id}`,
    relatedTools: ['tool1'],
  }
}

function mockSuccessResponse(skills: ReturnType<typeof makeSkill>[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ skills }),
  })
}

function mockErrorResponse(status = 500) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: 'Server error' }),
  })
}

function mockNetworkError() {
  mockFetch.mockRejectedValueOnce(new Error('Network failure'))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSkills', () => {
  it('returns isLoading: true initially, then isLoading: false with skills after fetch resolves', async () => {
    const skills = [makeSkill('security-audit'), makeSkill('architecture-review')]
    mockSuccessResponse(skills)

    // Dynamic import to get a fresh module with reset cache
    const { useSkills } = await import('@/hooks/use-skills')

    const { result } = renderHook(() => useSkills())

    // Initially loading
    expect(result.current.isLoading).toBe(true)
    expect(result.current.skills).toEqual([])

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.skills).toEqual(skills)
    expect(result.current.error).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith('/api/skills')
  })

  it('returns error when fetch fails with non-ok response', async () => {
    mockErrorResponse(500)

    const { useSkills } = await import('@/hooks/use-skills')

    const { result } = renderHook(() => useSkills())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toContain('Failed to fetch skills')
    expect(result.current.skills).toEqual([])
  })

  it('returns error when fetch throws a network error', async () => {
    mockNetworkError()

    const { useSkills } = await import('@/hooks/use-skills')

    const { result } = renderHook(() => useSkills())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('Network failure')
  })

  it('does not re-fetch on re-render (module-level cache)', async () => {
    const skills = [makeSkill('cached-skill')]
    mockSuccessResponse(skills)

    const { useSkills } = await import('@/hooks/use-skills')

    const { result, rerender } = renderHook(() => useSkills())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.skills).toEqual(skills)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Re-render the hook
    rerender()

    // Should still have the same data, no additional fetch
    expect(result.current.skills).toEqual(skills)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
