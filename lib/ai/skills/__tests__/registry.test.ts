import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SkillRegistry } from '../registry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFINITIONS_DIR = path.join(process.cwd(), 'lib', 'ai', 'skills', 'definitions')

const KNOWN_SKILL_IDS = ['architecture-analysis', 'git-analysis', 'security-audit', 'tour-creation']

// ---------------------------------------------------------------------------
// SkillRegistry — listSkills
// ---------------------------------------------------------------------------

describe('SkillRegistry — listSkills', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  it('returns all 4 skill summaries', () => {
    const skills = registry.listSkills()
    expect(skills).toHaveLength(4)
  })

  it('returns correct IDs for all skills', () => {
    const ids = registry.listSkills().map((s) => s.id)
    expect(ids.sort()).toEqual(KNOWN_SKILL_IDS)
  })

  it('each summary has required metadata fields', () => {
    const skills = registry.listSkills()
    for (const skill of skills) {
      expect(skill).toHaveProperty('id')
      expect(skill).toHaveProperty('name')
      expect(skill).toHaveProperty('description')
      expect(skill).toHaveProperty('trigger')
      expect(skill).toHaveProperty('relatedTools')
      expect(skill.name.length).toBeGreaterThan(0)
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.trigger.length).toBeGreaterThan(0)
      expect(skill.relatedTools.length).toBeGreaterThan(0)
    }
  })

  it('summaries do not include instructions', () => {
    const skills = registry.listSkills()
    for (const skill of skills) {
      expect(skill).not.toHaveProperty('instructions')
    }
  })
})

// ---------------------------------------------------------------------------
// SkillRegistry — getSkill
// ---------------------------------------------------------------------------

describe('SkillRegistry — getSkill', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  it('returns full definition for security-audit', () => {
    const skill = registry.getSkill('security-audit')
    expect(skill).not.toBeNull()
    expect(skill!.id).toBe('security-audit')
    expect(skill!.name).toBe('Security Audit')
    expect(skill!.description).toContain('security')
    expect(skill!.instructions).toBeTruthy()
    expect(skill!.instructions.length).toBeGreaterThan(0)
  })

  it('returns full definition for architecture-analysis', () => {
    const skill = registry.getSkill('architecture-analysis')
    expect(skill).not.toBeNull()
    expect(skill!.id).toBe('architecture-analysis')
    expect(skill!.name).toBe('Architecture Analysis')
  })

  it('returns full definition for git-analysis', () => {
    const skill = registry.getSkill('git-analysis')
    expect(skill).not.toBeNull()
    expect(skill!.id).toBe('git-analysis')
    expect(skill!.name).toBe('Git Analysis')
  })

  it('returns full definition for tour-creation', () => {
    const skill = registry.getSkill('tour-creation')
    expect(skill).not.toBeNull()
    expect(skill!.id).toBe('tour-creation')
    expect(skill!.name).toBe('Tour Creation')
  })

  it('returns null for nonexistent skill', () => {
    expect(registry.getSkill('nonexistent')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(registry.getSkill('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Slug Validation
// ---------------------------------------------------------------------------

describe('SkillRegistry — slug validation', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  it('accepts valid slug-format IDs', () => {
    // These shouldn't crash — they just return null because the skill doesn't exist
    expect(registry.getSkill('valid-id')).toBeNull()
    expect(registry.getSkill('my-skill-123')).toBeNull()
    expect(registry.getSkill('a')).toBeNull()
  })

  it('rejects path traversal attempts', () => {
    expect(registry.getSkill('../../etc/passwd')).toBeNull()
    expect(registry.getSkill('../../../etc/shadow')).toBeNull()
    expect(registry.getSkill('..%2F..%2Fetc%2Fpasswd')).toBeNull()
  })

  it('rejects uppercase characters', () => {
    expect(registry.getSkill('UPPERCASE')).toBeNull()
    expect(registry.getSkill('Security-Audit')).toBeNull()
  })

  it('rejects slugs with spaces', () => {
    expect(registry.getSkill('with spaces')).toBeNull()
    expect(registry.getSkill('security audit')).toBeNull()
  })

  it('rejects slugs with slashes', () => {
    expect(registry.getSkill('with/slashes')).toBeNull()
    expect(registry.getSkill('path/to/skill')).toBeNull()
  })

  it('rejects slugs exceeding max length', () => {
    const longSlug = 'a'.repeat(51)
    expect(registry.getSkill(longSlug)).toBeNull()
  })

  it('accepts slug at exactly max length (50)', () => {
    const maxSlug = 'a'.repeat(50)
    // Valid slug format, just doesn't match an existing skill
    expect(registry.getSkill(maxSlug)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Lazy Loading / Cache
// ---------------------------------------------------------------------------

describe('SkillRegistry — lazy loading', () => {
  it('loads definitions only once across multiple calls', () => {
    const registry = new SkillRegistry()
    const readdirSpy = vi.spyOn(fs, 'readdirSync')

    // First call triggers load
    registry.listSkills()
    const callCountAfterFirst = readdirSpy.mock.calls.length

    // Subsequent calls should not re-read the filesystem
    registry.listSkills()
    registry.getSkill('security-audit')
    registry.listSkills()

    expect(readdirSpy.mock.calls.length).toBe(callCountAfterFirst)
    readdirSpy.mockRestore()
  })

  it('getSkill triggers lazy load if not yet loaded', () => {
    const registry = new SkillRegistry()
    const readdirSpy = vi.spyOn(fs, 'readdirSync')

    registry.getSkill('security-audit')
    expect(readdirSpy).toHaveBeenCalled()

    readdirSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Frontmatter Validation
// ---------------------------------------------------------------------------

describe('SkillRegistry — skill definition frontmatter', () => {
  it('all 4 definition files exist on disk', () => {
    const files = fs.readdirSync(DEFINITIONS_DIR).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(4)
  })

  it('all definitions have valid parseable frontmatter', () => {
    const registry = new SkillRegistry()
    const skills = registry.listSkills()

    // If frontmatter were invalid, the skill would be skipped.
    // We verify all 4 are loaded.
    expect(skills).toHaveLength(4)
    for (const skill of skills) {
      expect(skill.id).toMatch(/^[a-z0-9-]+$/)
      expect(skill.name.length).toBeLessThanOrEqual(200)
      expect(skill.description.length).toBeLessThanOrEqual(500)
      expect(skill.trigger.length).toBeLessThanOrEqual(500)
      expect(skill.relatedTools.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('each skill definition has non-empty instructions', () => {
    const registry = new SkillRegistry()
    for (const id of KNOWN_SKILL_IDS) {
      const skill = registry.getSkill(id)
      expect(skill).not.toBeNull()
      expect(skill!.instructions.trim().length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Edge Cases — missing definitions directory
// ---------------------------------------------------------------------------

describe('SkillRegistry — missing definitions directory', () => {
  it('returns empty list when definitions dir does not exist', () => {
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    const registry = new SkillRegistry()
    expect(registry.listSkills()).toEqual([])

    readdirSpy.mockRestore()
  })
})
