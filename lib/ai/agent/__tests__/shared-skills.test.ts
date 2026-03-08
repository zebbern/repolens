import { describe, it, expect } from 'vitest'
import { skillDiscoverySection } from '../prompts/shared'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skillDiscoverySection — activeSkills integration', () => {
  it('without activeSkills, output contains generic discovery text', () => {
    const section = skillDiscoverySection()
    expect(section).toContain('discoverSkills')
    expect(section).toContain('## Skill System')
    expect(section).not.toContain('The user has activated these skills')
  })

  it('with undefined activeSkills, output matches the no-skills variant', () => {
    const withUndefined = skillDiscoverySection(undefined)
    const withoutArg = skillDiscoverySection()
    expect(withUndefined).toBe(withoutArg)
  })

  it('with empty array, output matches the no-skills variant', () => {
    const withEmpty = skillDiscoverySection([])
    const withoutArg = skillDiscoverySection()
    expect(withEmpty).toBe(withoutArg)
  })

  it('with activeSkills: ["security-audit"], output contains skill name and loadSkill instruction', () => {
    const section = skillDiscoverySection(['security-audit'])
    expect(section).toContain('security-audit')
    expect(section).toContain('loadSkill')
    expect(section).toContain('The user has activated these skills')
  })

  it('with multiple activeSkills, lists all skill IDs', () => {
    const section = skillDiscoverySection(['security-audit', 'architecture-review'])
    expect(section).toContain('security-audit')
    expect(section).toContain('architecture-review')
  })
})
