import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DepsSummary } from '../deps-summary'
import type { DependencyHealth } from '@/lib/deps/types'

function makeDep(overrides: Partial<DependencyHealth> = {}): DependencyHealth {
  return {
    dependencyKey: 'test-pkg@1.0.0',
    packageName: 'test-pkg',
    currentVersion: '1.0.0',
    requestedRange: '^1.0.0',
    installedVersion: '1.0.0',
    versionSource: 'lockfile',
    latestVersion: '1.0.0',
    npmMeta: null,
    isOutdated: false,
    outdatedType: null,
    cveCount: 0,
    score: 85,
    grade: 'A',
    ...overrides,
  }
}

describe('DepsSummary', () => {
  it('renders total dependency count', () => {
    const deps = [
      makeDep({ packageName: 'react' }),
      makeDep({ packageName: 'vue' }),
      makeDep({ packageName: 'next' }),
    ]

    render(<DepsSummary deps={deps} />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Dependencies')).toBeInTheDocument()
  })

  it('renders grade distribution', () => {
    const deps = [
      makeDep({ packageName: 'pkg-a1', grade: 'A', score: 90 }),
      makeDep({ packageName: 'pkg-a2', grade: 'A', score: 85 }),
      makeDep({ packageName: 'pkg-b1', grade: 'B', score: 70 }),
      makeDep({ packageName: 'pkg-f1', grade: 'F', score: 10 }),
    ]

    render(<DepsSummary deps={deps} />)

    // A: 2, B: 1, F: 1
    expect(screen.getByText('A: 2')).toBeInTheDocument()
    expect(screen.getByText('B: 1')).toBeInTheDocument()
    expect(screen.getByText('F: 1')).toBeInTheDocument()
  })

  it('does not render grade pills for grades with 0 count', () => {
    const deps = [makeDep({ grade: 'A' })]

    render(<DepsSummary deps={deps} />)

    expect(screen.getByText('A: 1')).toBeInTheDocument()
    expect(screen.queryByText(/^B:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^C:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^D:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^F:/)).not.toBeInTheDocument()
  })

  it('renders total CVE count', () => {
    const deps = [
      makeDep({ packageName: 'react', cveCount: 2 }),
      makeDep({ packageName: 'vue', cveCount: 3 }),
      makeDep({ packageName: 'next', cveCount: 0 }),
    ]

    render(<DepsSummary deps={deps} />)

    expect(screen.getByText('Vulnerability occurrences')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('labels the sum across workspace rows as vulnerability occurrences', () => {
    const deps = [
      makeDep({ dependencyKey: 'packages/a:react@19.0.0', packageName: 'react', cveCount: 1 }),
      makeDep({ dependencyKey: 'packages/b:react@19.0.0', packageName: 'react', cveCount: 1 }),
    ]

    render(<DepsSummary deps={deps} />)

    expect(screen.getByText('Vulnerability occurrences')).toBeInTheDocument()
    expect(screen.queryByText('Known CVEs')).not.toBeInTheDocument()
  })

  it('renders zero CVE count', () => {
    const deps = [makeDep({ cveCount: 0 })]
    render(<DepsSummary deps={deps} />)
    expect(screen.getByText('Vulnerability occurrences')).toBeInTheDocument()
    // Multiple "0" texts may appear (CVEs, outdated) — check that the CVE card contains 0
    const cveLabel = screen.getByText('Vulnerability occurrences')
    const cveCard = cveLabel.closest('[class*="flex"]')!
    expect(cveCard.textContent).toContain('0')
  })

  it('renders total outdated count with breakdown', () => {
    const deps = [
      makeDep({ packageName: 'a', outdatedType: 'major', isOutdated: true }),
      makeDep({ packageName: 'b', outdatedType: 'minor', isOutdated: true }),
      makeDep({ packageName: 'c', outdatedType: 'patch', isOutdated: true }),
      makeDep({ packageName: 'd', outdatedType: null, isOutdated: false }),
    ]

    render(<DepsSummary deps={deps} />)

    expect(screen.getByText('Outdated')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1 major')).toBeInTheDocument()
    expect(screen.getByText('1 minor')).toBeInTheDocument()
    expect(screen.getByText('1 patch')).toBeInTheDocument()
  })

  it('renders empty state gracefully', () => {
    render(<DepsSummary deps={[]} />)

    expect(screen.getByText('Dependencies')).toBeInTheDocument()
    // Total should show 0
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1)
  })

  it('reports dependency signals that could not be evaluated', () => {
    render(<DepsSummary deps={[
      makeDep({ packageName: 'known', dependencyKey: 'known@1.0.0' }),
      makeDep({
        packageName: 'unknown',
        dependencyKey: 'unknown@range:^1',
        installedVersion: null,
        versionSource: 'manifest',
        cveCount: null,
        score: null,
        grade: null,
        outdatedStatus: 'unknown',
      }),
    ]} />)

    expect(screen.getByText('1 vulnerability status unknown')).toBeInTheDocument()
    expect(screen.getByText('1 version status unknown')).toBeInTheDocument()
    expect(screen.getByText('?: 1')).toBeInTheDocument()
  })

  it('uses neutral icons when dependency status is unknown', () => {
    render(<DepsSummary deps={[
      makeDep({
        packageName: 'unknown-cve',
        cveCount: null,
      }),
      makeDep({
        packageName: 'unknown-version',
        outdatedStatus: 'unknown',
      }),
    ]} />)

    const cveCard = screen.getByText('Vulnerability occurrences').closest('[class~="rounded-lg"]')!
    const outdatedCard = screen.getByText('Outdated').closest('[class~="rounded-lg"]')!

    expect(cveCard.querySelector('svg')).toHaveClass('text-muted-foreground')
    expect(cveCard.querySelector('svg')?.parentElement).toHaveClass('bg-muted')
    expect(outdatedCard.querySelector('svg')).toHaveClass('text-muted-foreground')
    expect(outdatedCard.querySelector('svg')?.parentElement).toHaveClass('bg-muted')
  })
})
