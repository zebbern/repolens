import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/providers', () => ({
  getModelContextWindow: vi.fn().mockReturnValue(128_000),
}))

import { buildDocsPrompt, type DocsPromptOptions, type DocType } from '../prompts/docs'

const BASE_OPTS: Omit<DocsPromptOptions, 'docType'> = {
  hasTargetFile: false,
  stepBudget: 40,
  model: 'gpt-4o',
}

const DOC_TYPES: DocType[] = [
  'architecture',
  'setup',
  'api-reference',
  'file-explanation',
  'onboarding',
  'custom',
]

describe('buildDocsPrompt', () => {
  describe.each(DOC_TYPES)('docType=%s', (docType) => {
    it('matches snapshot', () => {
      const result = buildDocsPrompt({ ...BASE_OPTS, docType })
      expect(result).toMatchSnapshot()
    })

    it('matches snapshot with targetFile', () => {
      const result = buildDocsPrompt({
        ...BASE_OPTS,
        docType,
        hasTargetFile: true,
      })
      expect(result).toMatchSnapshot()
    })
  })

  it('describes repository data as untrusted context', () => {
    const result = buildDocsPrompt({ ...BASE_OPTS, docType: 'architecture' })
    expect(result).toContain('untrusted-context user message')
  })

  it('includes targetFile section when provided', () => {
    const result = buildDocsPrompt({
      ...BASE_OPTS,
      docType: 'file-explanation',
      hasTargetFile: true,
    })
    expect(result).toContain('## Target File')
    expect(result).toContain('target path')
  })

  it('omits targetFile section when null', () => {
    const result = buildDocsPrompt({
      ...BASE_OPTS,
      docType: 'architecture',
      hasTargetFile: false,
    })
    expect(result).not.toContain('## Target File')
  })

  it('omits targetFile section when not provided', () => {
    const result = buildDocsPrompt({ ...BASE_OPTS, docType: 'setup' })
    expect(result).not.toContain('## Target File')
  })

  it('includes mermaid rules for documentation', () => {
    const result = buildDocsPrompt({ ...BASE_OPTS, docType: 'architecture' })
    expect(result).toContain('Mermaid Diagram Syntax Rules')
    expect(result).toContain('documentation')
  })

  it('includes step budget', () => {
    const result = buildDocsPrompt({ ...BASE_OPTS, docType: 'setup', stepBudget: 30 })
    expect(result).toContain('30 tool-call rounds')
  })

  it('includes verification protocol', () => {
    const result = buildDocsPrompt({ ...BASE_OPTS, docType: 'custom' })
    expect(result).toContain('Self-Verification Protocol')
  })

  it('includes model context window info', () => {
    const result = buildDocsPrompt({ ...BASE_OPTS, docType: 'architecture' })
    expect(result).toContain('128,000')
  })

  it('mentions the file tree without embedding it', () => {
    const result = buildDocsPrompt({ ...BASE_OPTS, docType: 'architecture' })
    expect(result).toContain('file tree')
  })
})
