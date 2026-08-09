import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/providers', () => ({
  getModelContextWindow: vi.fn().mockReturnValue(128_000),
}))

import { buildChatPrompt, type ChatPromptOptions } from '../prompts/chat'

const BASE_OPTS: ChatPromptOptions = {
  stepBudget: 50,
  contextWindow: 128_000,
  toolCount: 12,
  model: 'gpt-4o',
  hasRepositoryContext: false,
  hasPinnedContext: false,
}

describe('buildChatPrompt', () => {
  it('matches snapshot without repoContext', () => {
    const result = buildChatPrompt({ ...BASE_OPTS })
    expect(result).toMatchSnapshot()
  })

  it('matches snapshot with repoContext', () => {
    const result = buildChatPrompt({
      ...BASE_OPTS,
      hasRepositoryContext: true,
    })
    expect(result).toMatchSnapshot()
  })

  it('matches snapshot with repoContext and pinnedContext', () => {
    const result = buildChatPrompt({
      ...BASE_OPTS,
      hasRepositoryContext: true,
      hasPinnedContext: true,
    })
    expect(result).toMatchSnapshot()
  })

  it('includes CodeDoc identity', () => {
    const result = buildChatPrompt({ ...BASE_OPTS })
    expect(result).toContain('CodeDoc')
  })

  it('includes tool count', () => {
    const result = buildChatPrompt({ ...BASE_OPTS, toolCount: 12 })
    expect(result).toContain('12 tools')
  })

  it('includes step budget', () => {
    const result = buildChatPrompt({ ...BASE_OPTS, stepBudget: 30 })
    expect(result).toContain('30 tool-call rounds')
  })

  it('includes mermaid guidelines', () => {
    const result = buildChatPrompt({ ...BASE_OPTS })
    expect(result).toContain('Mermaid Diagram Guidelines')
  })

  it('describes repository context without embedding repository data', () => {
    const result = buildChatPrompt({ ...BASE_OPTS, hasRepositoryContext: true })
    expect(result).toContain('untrusted-context user message')
  })

  it('includes "No repository" message without repoContext', () => {
    const result = buildChatPrompt({ ...BASE_OPTS })
    expect(result).toContain('No repository is currently connected')
  })

  it('includes pinned context when provided', () => {
    const result = buildChatPrompt({
      ...BASE_OPTS,
      hasRepositoryContext: true,
      hasPinnedContext: true,
    })
    expect(result).toContain('Pinned files')
  })

  it('omits pinned files section without pinnedContext', () => {
    const result = buildChatPrompt({
      ...BASE_OPTS,
      hasRepositoryContext: true,
    })
    expect(result).not.toContain('Pinned Files')
  })

  it('includes structural index guidance for a connected repository', () => {
    const result = buildChatPrompt({ ...BASE_OPTS, hasRepositoryContext: true })
    expect(result).toContain('## Structural Index')
  })

  it('includes model context window info', () => {
    const result = buildChatPrompt({ ...BASE_OPTS })
    expect(result).toContain('128,000')
  })
})
