import { describe, it, expect } from 'vitest'
import { getModelContextWindow, getMaxIndexBytesForModel } from '../providers'

// ---------------------------------------------------------------------------
// getModelContextWindow
// ---------------------------------------------------------------------------

describe('getModelContextWindow', () => {
  it('returns 128000 for gpt-4o', () => {
    expect(getModelContextWindow('gpt-4o')).toBe(128_000)
  })

  it('returns 1048576 for gemini-2.0-flash', () => {
    expect(getModelContextWindow('gemini-2.0-flash')).toBe(1_048_576)
  })

  it('returns 200000 for claude-sonnet-4', () => {
    expect(getModelContextWindow('claude-sonnet-4')).toBe(200_000)
  })

  it('fuzzy-matches model IDs containing known keys', () => {
    // e.g. a dated variant of gpt-4o
    expect(getModelContextWindow('gpt-4o-2024-01-01')).toBe(128_000)
  })

  it('fuzzy-matches gemini variants', () => {
    expect(getModelContextWindow('gemini-2.5-flash-preview')).toBe(1_048_576)
  })

  it('returns 128000 default for unknown model', () => {
    expect(getModelContextWindow('some-unknown-model')).toBe(128_000)
  })
})

// ---------------------------------------------------------------------------
// getMaxIndexBytesForModel
// ---------------------------------------------------------------------------

describe('getMaxIndexBytesForModel', () => {
  it('returns a reasonable byte limit (>0, ≤1000000) for known models', () => {
    const limit = getMaxIndexBytesForModel('gpt-4o')
    expect(limit).toBeGreaterThan(0)
    expect(limit).toBeLessThanOrEqual(1_000_000)
  })

  it('returns higher limit for large-context models than small-context models', () => {
    const geminiLimit = getMaxIndexBytesForModel('gemini-2.0-flash') // 1M context
    const gpt4Limit = getMaxIndexBytesForModel('gpt-4')             // 8K context
    expect(geminiLimit).toBeGreaterThan(gpt4Limit)
  })

  it('caps at 1MB for very large context models', () => {
    // gemini-1.5-pro has 2M token context — raw calculation would exceed 1MB
    const limit = getMaxIndexBytesForModel('gemini-1.5-pro')
    expect(limit).toBeLessThanOrEqual(1_000_000)
  })

  it('returns a positive value for unknown models', () => {
    const limit = getMaxIndexBytesForModel('unknown-model')
    expect(limit).toBeGreaterThan(0)
  })
})
