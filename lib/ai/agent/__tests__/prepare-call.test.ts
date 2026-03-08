import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockModel, mockWrappedModel, mockStepCountIs } = vi.hoisted(() => ({
  mockModel: { id: 'mock-model' },
  mockWrappedModel: { id: 'mock-wrapped-model' },
  mockStepCountIs: vi.fn().mockReturnValue('mock-stop-condition'),
}))

vi.mock('ai', () => ({
  stepCountIs: (...args: unknown[]) => mockStepCountIs(...args),
  wrapLanguageModel: vi.fn().mockReturnValue(mockWrappedModel),
}))

vi.mock('../middleware', () => ({
  createLoggingMiddleware: vi.fn().mockReturnValue({ specificationVersion: 'v3' }),
}))

vi.mock('@/lib/ai/providers', () => ({
  createAIModel: vi.fn().mockReturnValue(mockModel),
  getModelContextWindow: vi.fn().mockReturnValue(128_000),
}))

vi.mock('@/lib/ai/tool-definitions', () => ({
  codeTools: {
    readFile: {},
    readFiles: {},
    searchFiles: {},
    listDirectory: {},
    findSymbol: {},
    getFileStats: {},
    analyzeImports: {},
    scanIssues: {},
    generateDiagram: {},
    getProjectOverview: {},
    generateTour: {},
    getGitHistory: {},
  },
}))

import { buildPrepareCall } from '../prepare-call'
import { createAIModel } from '@/lib/ai/providers'
import type { CallOptions } from '../options'

const REPO_CONTEXT = {
  name: 'test-repo',
  description: 'A test repository',
  structure: 'src/\n  index.ts',
}

const BASE_CHAT: CallOptions = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'sk-test',
  mode: 'chat',
}

const BASE_DOCS: CallOptions = {
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  apiKey: 'sk-test',
  mode: 'docs',
  docType: 'architecture',
  repoContext: REPO_CONTEXT,
}

const BASE_CHANGELOG: CallOptions = {
  provider: 'google',
  model: 'gemini-2.5-flash',
  apiKey: 'sk-test',
  mode: 'changelog',
  changelogType: 'conventional',
  repoContext: REPO_CONTEXT,
  fromRef: 'v1.0.0',
  toRef: 'v2.0.0',
  commitData: 'abc feat: something',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildPrepareCall', () => {
  it('returns a function', () => {
    expect(typeof buildPrepareCall()).toBe('function')
  })

  describe('chat mode', () => {
    it('creates model with correct provider and apiKey', () => {
      const prepareCall = buildPrepareCall()
      prepareCall({ options: BASE_CHAT })
      expect(createAIModel).toHaveBeenCalledWith('openai', 'gpt-4o', 'sk-test')
    })

    it('returns the created model (wrapped with middleware)', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({ options: BASE_CHAT })
      expect(result.model).toBe(mockWrappedModel)
    })

    it('returns instructions string', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({ options: BASE_CHAT })
      expect(typeof result.instructions).toBe('string')
      expect(result.instructions.length).toBeGreaterThan(0)
    })

    it('returns stopWhen with default stepBudget of 50', () => {
      const prepareCall = buildPrepareCall()
      prepareCall({ options: BASE_CHAT })
      expect(mockStepCountIs).toHaveBeenCalledWith(50)
    })

    it('returns stopWhen with custom maxSteps', () => {
      const prepareCall = buildPrepareCall()
      prepareCall({ options: { ...BASE_CHAT, maxSteps: 30 } })
      expect(mockStepCountIs).toHaveBeenCalledWith(30)
    })

    it('returns experimental_context with compaction info', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({ options: BASE_CHAT })
      expect(result.experimental_context).toEqual({
        maxSteps: 50,
        model: 'gpt-4o',
        provider: 'openai',
        contextWindow: 128_000,
      })
    })
  })

  describe('docs mode', () => {
    it('creates model with correct provider', () => {
      const prepareCall = buildPrepareCall()
      prepareCall({ options: BASE_DOCS })
      expect(createAIModel).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4', 'sk-test')
    })

    it('returns instructions with docs-specific content', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({ options: BASE_DOCS })
      expect(result.instructions).toContain('Architecture')
    })

    it('uses default stepBudget of 40 for docs', () => {
      const prepareCall = buildPrepareCall()
      prepareCall({ options: BASE_DOCS })
      expect(mockStepCountIs).toHaveBeenCalledWith(40)
    })
  })

  describe('changelog mode', () => {
    it('creates model with correct provider', () => {
      const prepareCall = buildPrepareCall()
      prepareCall({ options: BASE_CHANGELOG })
      expect(createAIModel).toHaveBeenCalledWith('google', 'gemini-2.5-flash', 'sk-test')
    })

    it('returns instructions with changelog-specific content', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({ options: BASE_CHANGELOG })
      expect(result.instructions).toContain('Conventional Commits')
    })

    it('uses default stepBudget of 40 for changelog', () => {
      const prepareCall = buildPrepareCall()
      prepareCall({ options: BASE_CHANGELOG })
      expect(mockStepCountIs).toHaveBeenCalledWith(40)
    })
  })

  describe('Anthropic provider options', () => {
    it('includes providerOptions when provider is anthropic', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({
        options: { ...BASE_DOCS },
      })
      expect(result.providerOptions).toBeDefined()
      expect(result.providerOptions?.anthropic).toBeDefined()
      expect(result.providerOptions!.anthropic.contextManagement).toBeDefined()
    })

    it('providerOptions includes clear_tool_uses and compact edits', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({
        options: { ...BASE_DOCS },
      })
      const edits = result.providerOptions!.anthropic.contextManagement.edits
      expect(edits).toHaveLength(2)
      expect(edits[0].type).toBe('clear_tool_uses_20250919')
      expect(edits[1].type).toBe('compact_20260112')
    })

    it('does NOT include providerOptions for non-Anthropic providers', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({
        options: { ...BASE_CHAT, provider: 'openai' },
      })
      expect(result.providerOptions).toBeUndefined()
    })

    it('includes providerOptions for anthropic in chat mode', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({
        options: { ...BASE_CHAT, provider: 'anthropic' },
      })
      expect(result.providerOptions).toBeDefined()
    })

    it('includes providerOptions for anthropic in changelog mode', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({
        options: { ...BASE_CHANGELOG, provider: 'anthropic' },
      })
      expect(result.providerOptions).toBeDefined()
    })

    it('google provider has no providerOptions', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({
        options: { ...BASE_CHANGELOG },
      })
      expect(result.providerOptions).toBeUndefined()
    })

    it('openrouter provider has no providerOptions', () => {
      const prepareCall = buildPrepareCall()
      const result = prepareCall({
        options: { ...BASE_CHAT, provider: 'openrouter' },
      })
      expect(result.providerOptions).toBeUndefined()
    })
  })
})
