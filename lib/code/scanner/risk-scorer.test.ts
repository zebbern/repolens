import { scoreIssue, scoreProject, getRiskBand, getRiskDistribution, buildCvssVector } from '@/lib/code/scanner/risk-scorer'
import type { CodeIssue } from '@/lib/code/scanner/types'

/** Helper to create a minimal CodeIssue for testing. */
function makeIssue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: 'test-1',
    ruleId: 'test-rule',
    category: 'bad-practice',
    severity: 'warning',
    title: 'Test issue',
    description: 'A test issue',
    file: 'src/index.ts',
    line: 1,
    column: 1,
    snippet: 'const x = 1',
    ...overrides,
  }
}

describe('scoreIssue', () => {
  it('scores critical+security+high-confidence issue near 10.0', () => {
    const issue = makeIssue({
      severity: 'critical',
      category: 'security',
      confidence: 'high',
      cwe: 'CWE-79',
    })
    // 9.0 * 1.0 + 1.0 + 0.5 = 10.5 → clamped to 10.0
    expect(scoreIssue(issue)).toBe(10.0)
  })

  it('scores info+bad-practice+low-confidence issue near 1.0', () => {
    const issue = makeIssue({
      severity: 'info',
      category: 'bad-practice',
      confidence: 'low',
    })
    // 2.0 * 0.5 + 0.0 + 0.0 = 1.0
    expect(scoreIssue(issue)).toBe(1.0)
  })

  it('clamps score to a maximum of 10.0', () => {
    const issue = makeIssue({
      severity: 'critical',
      category: 'security',
      confidence: 'high',
      cwe: 'CWE-89',
    })
    // 9.0 * 1.0 + 1.0 + 0.5 = 10.5 → 10.0
    expect(scoreIssue(issue)).toBeLessThanOrEqual(10.0)
  })

  it('clamps score to a minimum of 0.0', () => {
    // Even the lowest possible combo (info, bad-practice, low, no CWE)
    // yields 1.0, so 0.0 can't be reached with valid inputs.
    // Verify it never goes below 0.
    const issue = makeIssue({
      severity: 'info',
      category: 'bad-practice',
      confidence: 'low',
    })
    expect(scoreIssue(issue)).toBeGreaterThanOrEqual(0.0)
  })

  it('defaults confidence to medium when undefined', () => {
    const issue = makeIssue({
      severity: 'warning',
      category: 'bad-practice',
      confidence: undefined,
    })
    // 5.0 * 0.8 + 0.0 + 0.0 = 4.0
    expect(scoreIssue(issue)).toBe(4.0)
  })

  it('adds CWE bonus when CWE is present', () => {
    const withCwe = makeIssue({
      severity: 'warning',
      category: 'bad-practice',
      confidence: 'high',
      cwe: 'CWE-22',
    })
    const withoutCwe = makeIssue({
      severity: 'warning',
      category: 'bad-practice',
      confidence: 'high',
    })
    expect(scoreIssue(withCwe) - scoreIssue(withoutCwe)).toBeCloseTo(0.5)
  })

  it('produces a result with exactly one decimal place', () => {
    const issue = makeIssue({
      severity: 'warning',
      category: 'reliability',
      confidence: 'medium',
      cwe: 'CWE-400',
    })
    const score = scoreIssue(issue)
    // Round to 1 decimal and check equality
    expect(score).toBe(Math.round(score * 10) / 10)
  })
})

describe('scoreProject', () => {
  it('returns 0.0 for an empty array', () => {
    expect(scoreProject([])).toBe(0.0)
  })

  it('returns the issue score when there is exactly one issue', () => {
    const issue = makeIssue({
      severity: 'critical',
      category: 'security',
      confidence: 'high',
      riskScore: 10.0,
    })
    expect(scoreProject([issue])).toBe(10.0)
  })

  it('computes a weighted average (not simple average)', () => {
    const highRisk = makeIssue({ riskScore: 9.0 })
    const lowRisk = makeIssue({ riskScore: 1.0 })
    const projectScore = scoreProject([highRisk, lowRisk])

    // Weighted: (9*9 + 1*1) / (9 + 1) = 82 / 10 = 8.2
    expect(projectScore).toBe(8.2)

    // Simple average would be 5.0 — weighted must differ
    expect(projectScore).not.toBe(5.0)
  })

  it('scores on-the-fly when riskScore is not set', () => {
    const issue = makeIssue({
      severity: 'warning',
      category: 'bad-practice',
      confidence: 'high',
    })
    // Should not throw; should compute score internally
    const score = scoreProject([issue])
    expect(score).toBeGreaterThan(0)
  })
})

describe('getRiskBand', () => {
  it('returns critical for score >= 8.0', () => {
    expect(getRiskBand(8.0)).toBe('critical')
    expect(getRiskBand(10.0)).toBe('critical')
  })

  it('returns high for score >= 5.0 and < 8.0', () => {
    expect(getRiskBand(5.0)).toBe('high')
    expect(getRiskBand(7.9)).toBe('high')
  })

  it('returns medium for score >= 3.0 and < 5.0', () => {
    expect(getRiskBand(3.0)).toBe('medium')
    expect(getRiskBand(4.9)).toBe('medium')
  })

  it('returns low for score < 3.0', () => {
    expect(getRiskBand(2.9)).toBe('low')
    expect(getRiskBand(0.0)).toBe('low')
  })
})

describe('getRiskDistribution', () => {
  it('returns all zeros for an empty array', () => {
    expect(getRiskDistribution([])).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    })
  })

  it('counts issues correctly across bands', () => {
    const issues = [
      makeIssue({ riskScore: 9.0 }),  // critical
      makeIssue({ riskScore: 8.5 }),  // critical
      makeIssue({ riskScore: 6.0 }),  // high
      makeIssue({ riskScore: 4.0 }),  // medium
      makeIssue({ riskScore: 1.0 }),  // low
    ]
    expect(getRiskDistribution(issues)).toEqual({
      critical: 2,
      high: 1,
      medium: 1,
      low: 1,
    })
  })
})

describe('buildCvssVector', () => {
  it('includes severity, confidence, and category', () => {
    const issue = makeIssue({
      severity: 'critical',
      category: 'security',
      confidence: 'high',
    })
    expect(buildCvssVector(issue)).toBe('S:critical/C:high/CAT:security')
  })

  it('includes CWE when present', () => {
    const issue = makeIssue({
      severity: 'warning',
      category: 'reliability',
      confidence: 'medium',
      cwe: 'CWE-79',
    })
    expect(buildCvssVector(issue)).toBe('S:warning/C:medium/CAT:reliability/CWE:79')
  })

  it('defaults confidence to medium when undefined', () => {
    const issue = makeIssue({
      severity: 'info',
      category: 'bad-practice',
      confidence: undefined,
    })
    expect(buildCvssVector(issue)).toBe('S:info/C:medium/CAT:bad-practice')
  })

  it('includes all components for a fully-specified issue', () => {
    const issue = makeIssue({
      severity: 'critical',
      category: 'security',
      confidence: 'high',
      cwe: 'CWE-89',
    })
    const vector = buildCvssVector(issue)
    expect(vector).toContain('S:critical')
    expect(vector).toContain('C:high')
    expect(vector).toContain('CAT:security')
    expect(vector).toContain('CWE:89')
  })
})
