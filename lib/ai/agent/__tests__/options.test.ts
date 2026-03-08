import { describe, it, expect } from 'vitest'
import { callOptionsSchema } from '../options'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = {
  provider: 'openai' as const,
  model: 'gpt-4o',
  apiKey: 'sk-test-key',
}

const REPO_CONTEXT = {
  name: 'test-repo',
  description: 'A test repository',
  structure: 'src/\n  index.ts',
}

// ---------------------------------------------------------------------------
// Chat mode
// ---------------------------------------------------------------------------

describe('callOptionsSchema — chat mode', () => {
  it('accepts minimal chat body', () => {
    const result = callOptionsSchema.safeParse({ ...BASE, mode: 'chat' })
    expect(result.success).toBe(true)
  })

  it('accepts chat with all optional fields', () => {
    const result = callOptionsSchema.safeParse({
      ...BASE,
      mode: 'chat',
      repoContext: REPO_CONTEXT,
      structuralIndex: '{}',
      pinnedContext: 'some pinned content',
      maxSteps: 50,
    })
    expect(result.success).toBe(true)
  })

  it('accepts chat without repoContext', () => {
    const result = callOptionsSchema.safeParse({ ...BASE, mode: 'chat' })
    expect(result.success).toBe(true)
  })

  it('accepts maxSteps at boundaries for chat (10 and 100)', () => {
    expect(callOptionsSchema.safeParse({ ...BASE, mode: 'chat', maxSteps: 10 }).success).toBe(true)
    expect(callOptionsSchema.safeParse({ ...BASE, mode: 'chat', maxSteps: 100 }).success).toBe(true)
  })

  it('rejects maxSteps outside bounds for chat', () => {
    expect(callOptionsSchema.safeParse({ ...BASE, mode: 'chat', maxSteps: 9 }).success).toBe(false)
    expect(callOptionsSchema.safeParse({ ...BASE, mode: 'chat', maxSteps: 101 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Docs mode
// ---------------------------------------------------------------------------

describe('callOptionsSchema — docs mode', () => {
  it('accepts valid docs body', () => {
    const result = callOptionsSchema.safeParse({
      ...BASE,
      mode: 'docs',
      docType: 'architecture',
      repoContext: REPO_CONTEXT,
    })
    expect(result.success).toBe(true)
  })

  it('accepts all 6 doc types', () => {
    const types = ['architecture', 'setup', 'api-reference', 'file-explanation', 'onboarding', 'custom'] as const
    for (const docType of types) {
      const result = callOptionsSchema.safeParse({
        ...BASE,
        mode: 'docs',
        docType,
        repoContext: REPO_CONTEXT,
      })
      expect(result.success, `docType=${docType} should be valid`).toBe(true)
    }
  })

  it('rejects docs without repoContext', () => {
    const result = callOptionsSchema.safeParse({
      ...BASE,
      mode: 'docs',
      docType: 'architecture',
    })
    expect(result.success).toBe(false)
  })

  it('rejects docs without docType', () => {
    const result = callOptionsSchema.safeParse({
      ...BASE,
      mode: 'docs',
      repoContext: REPO_CONTEXT,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid docType', () => {
    const result = callOptionsSchema.safeParse({
      ...BASE,
      mode: 'docs',
      docType: 'nonexistent',
      repoContext: REPO_CONTEXT,
    })
    expect(result.success).toBe(false)
  })

  it('accepts docs maxSteps boundaries (10 and 80)', () => {
    const opts = { ...BASE, mode: 'docs', docType: 'setup', repoContext: REPO_CONTEXT }
    expect(callOptionsSchema.safeParse({ ...opts, maxSteps: 10 }).success).toBe(true)
    expect(callOptionsSchema.safeParse({ ...opts, maxSteps: 80 }).success).toBe(true)
  })

  it('rejects docs maxSteps outside bounds', () => {
    const opts = { ...BASE, mode: 'docs', docType: 'setup', repoContext: REPO_CONTEXT }
    expect(callOptionsSchema.safeParse({ ...opts, maxSteps: 9 }).success).toBe(false)
    expect(callOptionsSchema.safeParse({ ...opts, maxSteps: 81 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Changelog mode
// ---------------------------------------------------------------------------

describe('callOptionsSchema — changelog mode', () => {
  const CHANGELOG_BASE = {
    ...BASE,
    mode: 'changelog' as const,
    changelogType: 'conventional' as const,
    repoContext: REPO_CONTEXT,
    fromRef: 'v1.0.0',
    toRef: 'v2.0.0',
    commitData: 'abc123 feat: something',
  }

  it('accepts valid changelog body', () => {
    const result = callOptionsSchema.safeParse(CHANGELOG_BASE)
    expect(result.success).toBe(true)
  })

  it('accepts all 4 changelog types', () => {
    const types = ['conventional', 'release-notes', 'keep-a-changelog', 'custom'] as const
    for (const changelogType of types) {
      const result = callOptionsSchema.safeParse({ ...CHANGELOG_BASE, changelogType })
      expect(result.success, `changelogType=${changelogType} should be valid`).toBe(true)
    }
  })

  it('rejects changelog without repoContext', () => {
    const { repoContext, ...rest } = CHANGELOG_BASE
    const result = callOptionsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects changelog without fromRef', () => {
    const { fromRef, ...rest } = CHANGELOG_BASE
    const result = callOptionsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects changelog without toRef', () => {
    const { toRef, ...rest } = CHANGELOG_BASE
    const result = callOptionsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects changelog without commitData', () => {
    const { commitData, ...rest } = CHANGELOG_BASE
    const result = callOptionsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects changelog without changelogType', () => {
    const { changelogType, ...rest } = CHANGELOG_BASE
    const result = callOptionsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects invalid changelogType', () => {
    const result = callOptionsSchema.safeParse({ ...CHANGELOG_BASE, changelogType: 'invalid' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Shared / cross-mode validation
// ---------------------------------------------------------------------------

describe('callOptionsSchema — shared validation', () => {
  it('rejects missing mode field', () => {
    const result = callOptionsSchema.safeParse({ ...BASE })
    expect(result.success).toBe(false)
  })

  it('rejects invalid mode value', () => {
    const result = callOptionsSchema.safeParse({ ...BASE, mode: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('rejects missing provider', () => {
    const { provider, ...rest } = BASE
    const result = callOptionsSchema.safeParse({ ...rest, mode: 'chat' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid provider', () => {
    const result = callOptionsSchema.safeParse({ ...BASE, provider: 'azure', mode: 'chat' })
    expect(result.success).toBe(false)
  })

  it('rejects missing model', () => {
    const { model, ...rest } = BASE
    const result = callOptionsSchema.safeParse({ ...rest, mode: 'chat' })
    expect(result.success).toBe(false)
  })

  it('rejects empty model string', () => {
    const result = callOptionsSchema.safeParse({ ...BASE, model: '', mode: 'chat' })
    expect(result.success).toBe(false)
  })

  it('rejects missing apiKey', () => {
    const { apiKey, ...rest } = BASE
    const result = callOptionsSchema.safeParse({ ...rest, mode: 'chat' })
    expect(result.success).toBe(false)
  })

  it('rejects empty apiKey', () => {
    const result = callOptionsSchema.safeParse({ ...BASE, apiKey: '', mode: 'chat' })
    expect(result.success).toBe(false)
  })

  it('rejects apiKey exceeding 500 chars', () => {
    const result = callOptionsSchema.safeParse({ ...BASE, apiKey: 'a'.repeat(501), mode: 'chat' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid providers', () => {
    const providers = ['openai', 'google', 'anthropic', 'openrouter'] as const
    for (const provider of providers) {
      const result = callOptionsSchema.safeParse({ ...BASE, provider, mode: 'chat' })
      expect(result.success, `provider=${provider} should be valid`).toBe(true)
    }
  })

  it('rejects non-integer maxSteps', () => {
    const result = callOptionsSchema.safeParse({ ...BASE, mode: 'chat', maxSteps: 50.5 })
    expect(result.success).toBe(false)
  })

  it('rejects oversized structuralIndex', () => {
    const result = callOptionsSchema.safeParse({
      ...BASE,
      mode: 'chat',
      structuralIndex: 'x'.repeat(500_001),
    })
    expect(result.success).toBe(false)
  })

  it('rejects oversized structure in repoContext', () => {
    const result = callOptionsSchema.safeParse({
      ...BASE,
      mode: 'chat',
      repoContext: { ...REPO_CONTEXT, structure: 'x'.repeat(200_001) },
    })
    expect(result.success).toBe(false)
  })
})
