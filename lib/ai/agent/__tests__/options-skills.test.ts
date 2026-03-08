import { describe, it, expect } from 'vitest'
import { callOptionsSchema } from '@/lib/ai/agent/options'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validChatOptions(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'chat',
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-test-key',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('callOptionsSchema — activeSkills in chat mode', () => {
  it('accepts chat mode with valid activeSkills', () => {
    const result = callOptionsSchema.safeParse(
      validChatOptions({ activeSkills: ['security-audit', 'architecture-review'] }),
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mode).toBe('chat')
      expect('activeSkills' in result.data && result.data.activeSkills).toEqual([
        'security-audit',
        'architecture-review',
      ])
    }
  })

  it('accepts chat mode without activeSkills', () => {
    const result = callOptionsSchema.safeParse(validChatOptions())
    expect(result.success).toBe(true)
  })

  it('accepts chat mode with empty activeSkills array', () => {
    const result = callOptionsSchema.safeParse(
      validChatOptions({ activeSkills: [] }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects chat mode with invalid skill IDs (uppercase)', () => {
    const result = callOptionsSchema.safeParse(
      validChatOptions({ activeSkills: ['INVALID'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects chat mode with invalid skill IDs (special characters)', () => {
    const result = callOptionsSchema.safeParse(
      validChatOptions({ activeSkills: ['hello world!'] }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects chat mode with more than 10 skills', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `skill-${i}`)
    const result = callOptionsSchema.safeParse(
      validChatOptions({ activeSkills: tooMany }),
    )
    expect(result.success).toBe(false)
  })

  it('accepts activeSkills in docs mode', () => {
    const result = callOptionsSchema.safeParse({
      mode: 'docs',
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test-key',
      docType: 'architecture',
      repoContext: { name: 'repo', description: 'desc', structure: 'src/' },
      activeSkills: ['security-audit'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeSkills).toEqual(['security-audit'])
    }
  })

  it('accepts activeSkills in changelog mode', () => {
    const result = callOptionsSchema.safeParse({
      mode: 'changelog',
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test-key',
      changelogType: 'conventional',
      repoContext: { name: 'repo', description: 'desc', structure: 'src/' },
      fromRef: 'v1.0.0',
      toRef: 'v1.1.0',
      commitData: 'feat: new feature',
      activeSkills: ['security-audit'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeSkills).toEqual(['security-audit'])
    }
  })
})
