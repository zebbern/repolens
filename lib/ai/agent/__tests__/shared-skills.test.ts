import { describe, it, expect } from 'vitest'
import { skillDiscoverySection } from '../prompts/shared'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skillDiscoverySection — selected skill guidance', () => {
  it('without a selection count, output contains generic discovery text', () => {
    const section = skillDiscoverySection()
    expect(section).toContain('discoverSkills')
    expect(section).toContain('## Skill System')
    expect(section).not.toContain('The user selected')
  })

  it('with an undefined selection count, output matches the no-skills variant', () => {
    const withUndefined = skillDiscoverySection(undefined)
    const withoutArg = skillDiscoverySection()
    expect(withUndefined).toBe(withoutArg)
  })

  it('with zero selected skills, output matches the no-skills variant', () => {
    const withEmpty = skillDiscoverySection(0)
    const withoutArg = skillDiscoverySection()
    expect(withEmpty).toBe(withoutArg)
  })

  it('with selected skills, includes only a numeric count and live-tool guidance', () => {
    const section = skillDiscoverySection(2)
    expect(section).toContain('2 skills')
    expect(section).toContain('discoverSkills')
    expect(section).toContain('loadSkill')
  })
})
