import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  calculateDownloadScore,
  calculateMaintenanceScore,
  calculateSecurityScore,
  calculateOutdatedScore,
  scoreToGrade,
  calculateHealthScore,
  computeDependencyHealth,
} from '../health-scorer'
import type { NpmPackageMeta } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(overrides: Partial<NpmPackageMeta> = {}): NpmPackageMeta {
  return {
    name: 'test-package',
    version: '1.0.0',
    description: 'A test package',
    license: 'MIT',
    maintainers: 3,
    lastPublish: new Date().toISOString(), // recent publish
    weeklyDownloads: 500_000,
    downloadTrend: [],
    deprecated: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// calculateDownloadScore
// ---------------------------------------------------------------------------

describe('calculateDownloadScore', () => {
  it('returns 0 for 0 downloads', () => {
    expect(calculateDownloadScore(0)).toBe(0)
  })

  it('returns 0 for negative downloads', () => {
    expect(calculateDownloadScore(-100)).toBe(0)
  })

  it('returns 100 for 1M+ downloads', () => {
    expect(calculateDownloadScore(1_000_000)).toBe(100)
  })

  it('returns 100 for downloads well above 1M', () => {
    expect(calculateDownloadScore(50_000_000)).toBe(100)
  })

  it('returns approximately 50 for 1000 downloads (log10(1000)=3 → 3/6*100=50)', () => {
    expect(calculateDownloadScore(1_000)).toBe(50)
  })

  it('returns approximately 67 for 10k downloads', () => {
    expect(calculateDownloadScore(10_000)).toBe(67)
  })

  it('returns approximately 83 for 100k downloads', () => {
    expect(calculateDownloadScore(100_000)).toBe(83)
  })

  it('returns a score between 1 and 100 for small positive downloads', () => {
    const score = calculateDownloadScore(10)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })

  it('is monotonically increasing with downloads', () => {
    const s1 = calculateDownloadScore(100)
    const s2 = calculateDownloadScore(1_000)
    const s3 = calculateDownloadScore(10_000)
    const s4 = calculateDownloadScore(100_000)
    expect(s2).toBeGreaterThan(s1)
    expect(s3).toBeGreaterThan(s2)
    expect(s4).toBeGreaterThan(s3)
  })
})

// ---------------------------------------------------------------------------
// calculateMaintenanceScore
// ---------------------------------------------------------------------------

describe('calculateMaintenanceScore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-05T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 0 for deprecated packages', () => {
    expect(calculateMaintenanceScore('2026-03-01', true)).toBe(0)
  })

  it('returns 100 for packages published within 3 months', () => {
    expect(calculateMaintenanceScore('2026-01-10T00:00:00Z', false)).toBe(100)
  })

  it('returns 80 for packages published 3-6 months ago', () => {
    // 4 months ago: 2025-11-05
    expect(calculateMaintenanceScore('2025-11-05T00:00:00Z', false)).toBe(80)
  })

  it('returns 60 for packages published 6-12 months ago', () => {
    // 8 months ago: 2025-07-05
    expect(calculateMaintenanceScore('2025-07-05T00:00:00Z', false)).toBe(60)
  })

  it('returns 40 for packages published 1-2 years ago', () => {
    // 18 months ago: 2024-09-05
    expect(calculateMaintenanceScore('2024-09-05T00:00:00Z', false)).toBe(40)
  })

  it('returns 20 for packages published more than 2 years ago', () => {
    // 3 years ago: 2023-03-05
    expect(calculateMaintenanceScore('2023-03-05T00:00:00Z', false)).toBe(20)
  })

  it('returns 20 for unparseable date', () => {
    expect(calculateMaintenanceScore('not-a-date', false)).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// calculateSecurityScore
// ---------------------------------------------------------------------------

describe('calculateSecurityScore', () => {
  it('returns 100 for 0 CVEs', () => {
    expect(calculateSecurityScore(0)).toBe(100)
  })

  it('returns 100 for negative CVEs (edge case)', () => {
    expect(calculateSecurityScore(-1)).toBe(100)
  })

  it('returns 60 for 1 CVE', () => {
    expect(calculateSecurityScore(1)).toBe(60)
  })

  it('returns 30 for 2 CVEs', () => {
    expect(calculateSecurityScore(2)).toBe(30)
  })

  it('returns 0 for 3 CVEs', () => {
    expect(calculateSecurityScore(3)).toBe(0)
  })

  it('returns 0 for many CVEs', () => {
    expect(calculateSecurityScore(10)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// calculateOutdatedScore
// ---------------------------------------------------------------------------

describe('calculateOutdatedScore', () => {
  it('returns 100 when up-to-date (null)', () => {
    expect(calculateOutdatedScore(null)).toBe(100)
  })

  it('returns 70 for patch behind', () => {
    expect(calculateOutdatedScore('patch')).toBe(70)
  })

  it('returns 40 for minor behind', () => {
    expect(calculateOutdatedScore('minor')).toBe(40)
  })

  it('returns 10 for major behind', () => {
    expect(calculateOutdatedScore('major')).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// scoreToGrade
// ---------------------------------------------------------------------------

describe('scoreToGrade', () => {
  it.each([
    { score: 100, grade: 'A' },
    { score: 85, grade: 'A' },
    { score: 80, grade: 'A' },
    { score: 79, grade: 'B' },
    { score: 65, grade: 'B' },
    { score: 64, grade: 'C' },
    { score: 50, grade: 'C' },
    { score: 49, grade: 'D' },
    { score: 35, grade: 'D' },
    { score: 34, grade: 'F' },
    { score: 0, grade: 'F' },
  ])('maps score $score → grade "$grade"', ({ score, grade }) => {
    expect(scoreToGrade(score)).toBe(grade)
  })
})

// ---------------------------------------------------------------------------
// calculateHealthScore
// ---------------------------------------------------------------------------

describe('calculateHealthScore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-05T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a high score for a healthy package', () => {
    const meta = makeMeta({
      weeklyDownloads: 1_000_000,
      lastPublish: '2026-03-01T00:00:00Z',
      deprecated: false,
    })
    const score = calculateHealthScore(meta, 0, null)
    // downloads=100, maintenance=100, security=100, outdated=100 → 100
    expect(score).toBe(100)
  })

  it('returns a low score for a deprecated package with CVEs that is major behind', () => {
    const meta = makeMeta({
      weeklyDownloads: 50,
      lastPublish: '2023-01-01T00:00:00Z',
      deprecated: true,
    })
    // downloads=~28, maintenance=0 (deprecated), security=0 (3+ CVEs), outdated=10
    const score = calculateHealthScore(meta, 5, 'major')
    expect(score).toBeLessThanOrEqual(10)
  })

  it('withholds a score when metadata is unavailable', () => {
    expect(calculateHealthScore(null, 0, null)).toBeNull()
    expect(calculateHealthScore(makeMeta({ lastPublish: null }), 0, null)).toBeNull()
  })

  it('factors in download score at 20% weight', () => {
    const metaHigh = makeMeta({ weeklyDownloads: 1_000_000, lastPublish: '2026-03-01T00:00:00Z' })
    const metaLow = makeMeta({ weeklyDownloads: 1, lastPublish: '2026-03-01T00:00:00Z' })

    const highScore = calculateHealthScore(metaHigh, 0, null)
    const lowScore = calculateHealthScore(metaLow, 0, null)

    expect(highScore!).toBeGreaterThan(lowScore!)
  })

  it('uses outdatedType directly to determine outdated score', () => {
    const meta = makeMeta()
    // outdatedType='major' should yield a lower score
    const score = calculateHealthScore(meta, 0, 'major')
    expect(score).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// computeDependencyHealth
// ---------------------------------------------------------------------------

describe('computeDependencyHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-05T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns both score and grade', () => {
    const meta = makeMeta({ weeklyDownloads: 1_000_000, lastPublish: '2026-03-01T00:00:00Z' })
    const result = computeDependencyHealth(meta, 0, null)

    expect(result).toHaveProperty('score')
    expect(result).toHaveProperty('grade')
    expect(typeof result.score).toBe('number')
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade)
  })

  it('returns grade A for a healthy package', () => {
    const meta = makeMeta({ weeklyDownloads: 1_000_000, lastPublish: '2026-03-01T00:00:00Z' })
    const result = computeDependencyHealth(meta, 0, null)
    expect(result.grade).toBe('A')
    expect(result.score).toBeGreaterThanOrEqual(80)
  })

  it('returns grade F for a severely problematic package', () => {
    const meta = makeMeta({
      weeklyDownloads: 1,
      lastPublish: '2020-01-01T00:00:00Z',
      deprecated: true,
    })
    const result = computeDependencyHealth(meta, 5, 'major')
    expect(result.grade).toBe('F')
    expect(result.score).toBeLessThan(35)
  })

  it('withholds health when npm metadata is unavailable', () => {
    const result = computeDependencyHealth(null, 0, null)
    expect(result).toEqual({ score: null, grade: null, confidence: 'unknown' })
  })

  it('withholds health when the registry publish date is unavailable', () => {
    const result = computeDependencyHealth(makeMeta({ lastPublish: null }), 0, null)

    expect(result).toEqual({ score: null, grade: null, confidence: 'unknown' })
  })

  it('returns unknown health when metadata and CVE signals are unavailable', () => {
    const result = computeDependencyHealth(
      null,
      { status: 'unknown' },
      { status: 'unknown' },
    )

    expect(result).toEqual({ score: null, grade: null, confidence: 'unknown' })
  })

  it.each([
    [
      { status: 'unknown' as const, error: 'OSV unavailable' },
      { status: 'known' as const, value: null },
    ],
    [
      { status: 'known' as const, value: 0 },
      { status: 'unknown' as const, error: 'Installed version unresolved' },
    ],
  ])('withholds health when any required signal is unknown', (cveSignal, outdatedSignal) => {
    const result = computeDependencyHealth(makeMeta(), cveSignal, outdatedSignal)

    expect(result).toEqual({ score: null, grade: null, confidence: 'unknown' })
  })

  it('reports known confidence when metadata and both signals are known', () => {
    const result = computeDependencyHealth(
      makeMeta({ weeklyDownloads: 1_000_000 }),
      { status: 'known', value: 0 },
      { status: 'known', value: null },
    )

    expect(result.confidence).toBe('known')
    expect(result.score).not.toBeNull()
    expect(result.grade).not.toBeNull()
  })
})
