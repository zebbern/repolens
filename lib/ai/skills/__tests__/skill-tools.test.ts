import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the registry before importing skill-tools
vi.mock('../registry', () => {
  const mockSkills = new Map([
    [
      'security-audit',
      {
        id: 'security-audit',
        name: 'Security Audit',
        description: 'Structured methodology for security vulnerability analysis',
        trigger: 'When asked to review security or audit code safety',
        relatedTools: ['scanIssues', 'readFile', 'searchFiles'],
        instructions: '## Security Audit Instructions\n\nFollow the OWASP Top 10 methodology.',
      },
    ],
    [
      'architecture-analysis',
      {
        id: 'architecture-analysis',
        name: 'Architecture Analysis',
        description: 'Systematic approach to dependency mapping and architecture diagrams',
        trigger: 'When asked to analyze architecture or map dependencies',
        relatedTools: ['analyzeImports', 'getProjectOverview', 'generateDiagram'],
        instructions: '## Architecture Analysis Instructions\n\nAnalyze layers and dependencies.',
      },
    ],
  ])

  class MockSkillRegistry {
    getSkill(id: string) {
      // Replicate slug validation from real registry
      if (!/^[a-z0-9-]+$/.test(id) || id.length > 50) return null
      return mockSkills.get(id) ?? null
    }

    listSkills() {
      return Array.from(mockSkills.values()).map(({ id, name, description, trigger, relatedTools }) => ({
        id,
        name,
        description,
        trigger,
        relatedTools,
      }))
    }
  }

  return {
    skillRegistry: new MockSkillRegistry(),
    SkillRegistry: MockSkillRegistry,
  }
})

import { discoverSkillsTool, loadSkillTool } from '../skill-tools'

// ---------------------------------------------------------------------------
// discoverSkillsTool
// ---------------------------------------------------------------------------

describe('discoverSkillsTool', () => {
  it('has correct description', () => {
    expect(discoverSkillsTool.description).toContain('Discover available skills')
  })

  it('returns skill summaries without instructions', async () => {
    const result = await discoverSkillsTool.execute({}, { toolCallId: 'test', messages: [] })

    expect(result).toHaveProperty('skills')
    expect(result.skills).toHaveLength(2)

    for (const skill of result.skills) {
      expect(skill).toHaveProperty('id')
      expect(skill).toHaveProperty('name')
      expect(skill).toHaveProperty('description')
      expect(skill).toHaveProperty('trigger')
      expect(skill).toHaveProperty('relatedTools')
      expect(skill).not.toHaveProperty('instructions')
    }
  })

  it('returns correct metadata for each skill', async () => {
    const result = await discoverSkillsTool.execute({}, { toolCallId: 'test', messages: [] })
    const ids = result.skills.map((s) => s.id)
    expect(ids).toContain('security-audit')
    expect(ids).toContain('architecture-analysis')
  })
})

// ---------------------------------------------------------------------------
// loadSkillTool — valid skill
// ---------------------------------------------------------------------------

describe('loadSkillTool — valid skill', () => {
  it('returns skill with instructions wrapped in <skill-instructions> delimiters', async () => {
    const result = await loadSkillTool.execute(
      { skillId: 'security-audit' },
      { toolCallId: 'test', messages: [] },
    )

    // Should be a success result, not error
    expect(result).not.toHaveProperty('error')
    expect(result).toHaveProperty('id', 'security-audit')
    expect(result).toHaveProperty('name', 'Security Audit')
    expect(result).toHaveProperty('instructions')

    const instructions = (result as { instructions: string }).instructions
    expect(instructions).toContain('<skill-instructions source="security-audit">')
    expect(instructions).toContain('</skill-instructions>')
  })

  it('includes skill content inside the delimiters', async () => {
    const result = await loadSkillTool.execute(
      { skillId: 'security-audit' },
      { toolCallId: 'test', messages: [] },
    )

    const instructions = (result as { instructions: string }).instructions
    expect(instructions).toContain('OWASP Top 10')
  })

  it('includes provenance disclaimer in instructions', async () => {
    const result = await loadSkillTool.execute(
      { skillId: 'security-audit' },
      { toolCallId: 'test', messages: [] },
    )

    const instructions = (result as { instructions: string }).instructions
    expect(instructions).toContain('loaded from the skill registry')
    expect(instructions).toContain('not user input')
  })
})

// ---------------------------------------------------------------------------
// loadSkillTool — invalid skill
// ---------------------------------------------------------------------------

describe('loadSkillTool — invalid skill', () => {
  it('returns error for nonexistent skill ID', async () => {
    const result = await loadSkillTool.execute(
      { skillId: 'nonexistent' },
      { toolCallId: 'test', messages: [] },
    )

    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('not found')
    expect((result as { error: string }).error).toContain('discoverSkills')
  })

  it('returns error for empty-ish but valid slug', async () => {
    const result = await loadSkillTool.execute(
      { skillId: 'does-not-exist' },
      { toolCallId: 'test', messages: [] },
    )

    expect(result).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// loadSkillTool — path traversal / invalid slugs
// ---------------------------------------------------------------------------

describe('loadSkillTool — path traversal prevention', () => {
  it('rejects path traversal attempt via slug validation', async () => {
    // The schema itself rejects invalid slugs before execute runs,
    // but getSkill also validates. We test getSkill's validation here.
    const result = await loadSkillTool.execute(
      // @ts-expect-error — intentionally bypassing schema for security test
      { skillId: '../../etc/passwd' },
      { toolCallId: 'test', messages: [] },
    )

    // Should get null from getSkill (slug validation fails), then error response
    expect(result).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// Tool schema validation
// ---------------------------------------------------------------------------

describe('loadSkillTool — input schema', () => {
  it('has inputSchema requiring skillId', () => {
    const schema = loadSkillTool.inputSchema
    expect(schema).toBeDefined()

    // Valid slug passes
    expect(schema.safeParse({ skillId: 'security-audit' }).success).toBe(true)

    // Invalid slugs fail
    expect(schema.safeParse({ skillId: 'UPPERCASE' }).success).toBe(false)
    expect(schema.safeParse({ skillId: '../../etc/passwd' }).success).toBe(false)
    expect(schema.safeParse({ skillId: 'has spaces' }).success).toBe(false)
    expect(schema.safeParse({ skillId: 'a'.repeat(51) }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })
})

describe('discoverSkillsTool — input schema', () => {
  it('accepts empty object', () => {
    const schema = discoverSkillsTool.inputSchema
    expect(schema.safeParse({}).success).toBe(true)
  })
})
