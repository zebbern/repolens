import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — set up before importing the route
// ---------------------------------------------------------------------------

const mockListSkills = vi.fn()

vi.mock('@/lib/ai/skills/registry', () => ({
  skillRegistry: {
    listSkills: (...args: unknown[]) => mockListSkills(...args),
  },
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: () => null,
}))

import { GET } from '@/app/api/skills/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/skills', { method: 'GET' })
}

function makeSkill(id: string) {
  return {
    id,
    name: `Skill ${id}`,
    description: `Description for ${id}`,
    trigger: `Use when ${id}`,
    relatedTools: ['tool1', 'tool2'],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { skills: SkillSummary[] } with expected fields', async () => {
    const skills = [makeSkill('security-audit'), makeSkill('architecture-review')]
    mockListSkills.mockReturnValue(skills)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ skills })

    for (const skill of body.skills) {
      expect(skill).toHaveProperty('id')
      expect(skill).toHaveProperty('name')
      expect(skill).toHaveProperty('description')
      expect(skill).toHaveProperty('trigger')
      expect(skill).toHaveProperty('relatedTools')
      expect(Array.isArray(skill.relatedTools)).toBe(true)
    }
  })

  it('returns { skills: [] } when registry has no skills', async () => {
    mockListSkills.mockReturnValue([])

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ skills: [] })
  })

  it('returns rate limit response when rate limited', async () => {
    // Override the module-level mock for this one test
    const rateLimitModule = await import('@/lib/api/rate-limit')
    const original = rateLimitModule.applyRateLimit
    const rateLimitResponse = Response.json(
      { error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
      { status: 429 },
    )
    // @ts-expect-error — overriding the mock implementation for one call
    rateLimitModule.applyRateLimit = () => rateLimitResponse

    const res = await GET(makeRequest())
    expect(res.status).toBe(429)

    // Restore
    rateLimitModule.applyRateLimit = original
  })
})
