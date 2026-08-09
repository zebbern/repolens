import { describe, it, expect, vi } from 'vitest'

// Mock the AI SDK to prevent real agent construction side-effects
vi.mock('ai', () => ({
  tool: (def: Record<string, unknown>) => def,
  ToolLoopAgent: class MockToolLoopAgent {
    tools: Record<string, unknown>
    constructor(opts: { tools: Record<string, unknown> }) {
      this.tools = opts.tools
    }
  },
}))

// Mock providers to avoid env var requirements
vi.mock('@/lib/ai/providers', () => ({
  createAIModel: vi.fn(() => ({})),
}))

// Mock prepare-call and prepare-step
vi.mock('../prepare-call', () => ({
  buildPrepareCall: vi.fn(() => vi.fn()),
}))

vi.mock('../prepare-step', () => ({
  buildPrepareStep: vi.fn(() => vi.fn()),
}))

import { repoLensAgent } from '../agent'
import { skillDiscoverySection } from '../prompts/shared'

// ---------------------------------------------------------------------------
// Agent tool count
// ---------------------------------------------------------------------------

describe('repoLensAgent — tool registration', () => {
  it('has exactly 14 tools (12 code + 2 skill)', () => {
    const tools = (repoLensAgent as unknown as { tools: Record<string, unknown> }).tools
    const toolNames = Object.keys(tools)
    expect(toolNames).toHaveLength(14)
  })

  it('includes discoverSkills tool', () => {
    const tools = (repoLensAgent as unknown as { tools: Record<string, unknown> }).tools
    expect(tools).toHaveProperty('discoverSkills')
  })

  it('includes loadSkill tool', () => {
    const tools = (repoLensAgent as unknown as { tools: Record<string, unknown> }).tools
    expect(tools).toHaveProperty('loadSkill')
  })

  it('includes all 12 code tools', () => {
    const tools = (repoLensAgent as unknown as { tools: Record<string, unknown> }).tools
    const expectedCodeTools = [
      'readFile',
      'readFiles',
      'searchFiles',
      'listDirectory',
      'findSymbol',
      'getFileStats',
      'analyzeImports',
      'scanIssues',
      'generateDiagram',
      'getProjectOverview',
      'generateTour',
      'getGitHistory',
    ]
    for (const name of expectedCodeTools) {
      expect(tools).toHaveProperty(name)
    }
  })
})

// ---------------------------------------------------------------------------
// Prompt skill discovery section
// ---------------------------------------------------------------------------

describe('skillDiscoverySection', () => {
  it('includes skill system heading', () => {
    const section = skillDiscoverySection()
    expect(section).toContain('## Skill System')
  })

  it('mentions discoverSkills tool', () => {
    const section = skillDiscoverySection()
    expect(section).toContain('discoverSkills')
  })

  it('mentions loadSkill tool', () => {
    const section = skillDiscoverySection()
    expect(section).toContain('loadSkill')
  })

  it('provides guidance on when to use skills', () => {
    const section = skillDiscoverySection()
    expect(section).toContain('specialized methodologies')
  })
})
