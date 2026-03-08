import { describe, it, expect } from 'vitest'
import type {
  ChangelogType,
  ChangelogPreset,
  GeneratedChangelog,
  ChangelogGenContext,
} from '../types'

// ---------------------------------------------------------------------------
// Type-level verification tests — confirm shapes compile and accept valid data
// ---------------------------------------------------------------------------

describe('ChangelogType', () => {
  it('accepts all valid changelog types', () => {
    const types: ChangelogType[] = [
      'conventional',
      'release-notes',
      'keep-a-changelog',
      'custom',
    ]

    expect(types).toHaveLength(4)
    for (const t of types) {
      expect(typeof t).toBe('string')
    }
  })
})

describe('ChangelogPreset', () => {
  it('accepts a valid preset object', () => {
    const preset: ChangelogPreset = {
      id: 'conventional',
      label: 'Conventional Commits',
      description: 'Structured changelog following Conventional Commits spec.',
      icon: null,
      prompt: 'Generate a changelog...',
    }

    expect(preset.id).toBe('conventional')
    expect(preset.label).toBe('Conventional Commits')
    expect(preset.icon).toBeNull()
    expect(preset.prompt).toContain('Generate')
  })

  it('custom preset has empty prompt', () => {
    const preset: ChangelogPreset = {
      id: 'custom',
      label: 'Custom',
      description: 'Custom prompt',
      icon: null,
      prompt: '',
    }

    expect(preset.prompt).toBe('')
  })
})

describe('GeneratedChangelog', () => {
  it('accepts all required and optional fields', () => {
    const changelog: GeneratedChangelog = {
      id: 'changelog-1234567890',
      type: 'conventional',
      title: 'Conventional Commits (v1.0..v2.0)',
      messages: [],
      createdAt: new Date('2025-06-01'),
      fromRef: 'v1.0.0',
      toRef: 'v2.0.0',
      customPrompt: undefined,
    }

    expect(changelog.id).toContain('changelog-')
    expect(changelog.type).toBe('conventional')
    expect(changelog.messages).toEqual([])
    expect(changelog.createdAt).toBeInstanceOf(Date)
    expect(changelog.fromRef).toBe('v1.0.0')
    expect(changelog.toRef).toBe('v2.0.0')
  })

  it('works without optional fields', () => {
    const changelog: GeneratedChangelog = {
      id: 'changelog-abc',
      type: 'custom',
      title: 'My Changelog',
      messages: [],
      createdAt: new Date(),
    }

    expect(changelog.fromRef).toBeUndefined()
    expect(changelog.toRef).toBeUndefined()
    expect(changelog.customPrompt).toBeUndefined()
  })

  it('custom changelog stores the custom prompt', () => {
    const changelog: GeneratedChangelog = {
      id: 'changelog-custom',
      type: 'custom',
      title: 'Custom',
      messages: [],
      createdAt: new Date(),
      customPrompt: 'List only breaking changes',
    }

    expect(changelog.customPrompt).toBe('List only breaking changes')
  })
})

describe('ChangelogGenContext', () => {
  it('accepts all required and optional fields', () => {
    const ctx: ChangelogGenContext = {
      changelogType: 'conventional',
      fromRef: 'v1.0.0',
      toRef: 'v2.0.0',
      customPrompt: '',
      commitData: 'abc123 feat: add feature',
      maxSteps: 40,
    }

    expect(ctx.changelogType).toBe('conventional')
    expect(ctx.fromRef).toBe('v1.0.0')
    expect(ctx.toRef).toBe('v2.0.0')
    expect(ctx.customPrompt).toBe('')
    expect(ctx.commitData).toContain('abc123')
    expect(ctx.maxSteps).toBe(40)
  })

  it('works without optional fields', () => {
    const ctx: ChangelogGenContext = {
      changelogType: 'custom',
      fromRef: '',
      toRef: '',
      customPrompt: 'My custom prompt',
    }

    expect(ctx.commitData).toBeUndefined()
    expect(ctx.maxSteps).toBeUndefined()
  })
})
