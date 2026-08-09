import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/providers', () => ({
  getModelContextWindow: vi.fn().mockReturnValue(128_000),
}))

import { buildChangelogPrompt, type ChangelogPromptOptions } from '../prompts/changelog'
import type { ChangelogType } from '@/lib/changelog/types'

const BASE_OPTS: Omit<ChangelogPromptOptions, 'changelogType'> = {
  stepBudget: 40,
  model: 'gpt-4o',
}

const CHANGELOG_TYPES: ChangelogType[] = [
  'conventional',
  'release-notes',
  'keep-a-changelog',
  'custom',
]

describe('buildChangelogPrompt', () => {
  describe.each(CHANGELOG_TYPES)('changelogType=%s', (changelogType) => {
    it('matches snapshot', () => {
      const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType })
      expect(result).toMatchSnapshot()
    })
  })

  it('describes repository data as untrusted context', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'conventional' })
    expect(result).toContain('untrusted-context user message')
  })

  it('includes mermaid rules for changelog', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'conventional' })
    expect(result).toContain('Mermaid Diagram Syntax Rules')
    expect(result).toContain('the changelog')
  })

  it('includes step budget', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'conventional', stepBudget: 25 })
    expect(result).toContain('25 tool-call rounds')
  })

  it('includes verification protocol for changelog', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'conventional' })
    expect(result).toContain('Self-Verification Protocol')
    expect(result).toContain('commit data')
  })

  it('includes model context window info', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'conventional' })
    expect(result).toContain('128,000')
  })

  it('mentions file-tree context without embedding it', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'conventional' })
    expect(result).toContain('file tree')
  })

  it('conventional type includes emoji headings', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'conventional' })
    expect(result).toContain('Breaking Changes')
    expect(result).toContain('Features')
    expect(result).toContain('Bug Fixes')
  })

  it('release-notes type includes user-facing language', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'release-notes' })
    expect(result).toContain('user-facing release notes')
    expect(result).toContain('Highlights')
  })

  it('keep-a-changelog type follows keepachangelog spec', () => {
    const result = buildChangelogPrompt({ ...BASE_OPTS, changelogType: 'keep-a-changelog' })
    expect(result).toContain('Keep a Changelog')
    expect(result).toContain('### Added')
    expect(result).toContain('### Changed')
    expect(result).toContain('### Fixed')
  })
})
