import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DepsTable } from '../deps-table'
import type { DependencyHealth, NpmPackageMeta } from '@/lib/deps/types'

// Mock components used by DepsTable that may cause jsdom issues
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}))

// Mock Recharts — jsdom doesn't support SVG layout
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <svg>{children}</svg>,
  Area: () => <g data-testid="area" />,
  Tooltip: () => null,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function makeMeta(name: string): NpmPackageMeta {
  return {
    name,
    version: '2.0.0',
    description: `Package ${name}`,
    license: 'MIT',
    maintainers: 2,
    lastPublish: '2026-03-01T00:00:00Z',
    weeklyDownloads: 50_000,
    downloadTrend: [{ day: '2026-03-01', downloads: 7000 }],
    deprecated: false,
  }
}

function makeDep(
  name: string,
  overrides: Partial<DependencyHealth> = {},
): DependencyHealth {
  return {
    dependencyKey: `${name}@1.0.0`,
    packageName: name,
    currentVersion: '1.0.0',
    requestedRange: '^1.0.0',
    installedVersion: '1.0.0',
    versionSource: 'lockfile',
    latestVersion: '2.0.0',
    npmMeta: makeMeta(name),
    isOutdated: true,
    outdatedType: 'major',
    cveCount: 0,
    score: 60,
    grade: 'C',
    ...overrides,
  }
}

const defaultDeps: DependencyHealth[] = [
  makeDep('react', { score: 90, grade: 'A', isOutdated: false, outdatedType: null }),
  makeDep('vue', { score: 60, grade: 'C' }),
  makeDep('next', { score: 40, grade: 'D', cveCount: 2 }),
]

const defaultDepTypes = new Map<string, 'production' | 'dev'>([
  ['react', 'production'],
  ['vue', 'dev'],
  ['next', 'production'],
])

describe('DepsTable', () => {
  it('renders all column headers', () => {
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    const expectedHeaders = ['Package', 'Type', 'Version', 'Latest', 'Downloads', 'Updated', 'Vuln. occurrences', 'Grade']
    for (const header of expectedHeaders) {
      expect(screen.getByText(header)).toBeInTheDocument()
    }
  })

  it('renders all dependency rows', () => {
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    expect(screen.getByText('react')).toBeInTheDocument()
    expect(screen.getByText('vue')).toBeInTheDocument()
    expect(screen.getByText('next')).toBeInTheDocument()
  })

  it('sorts by grade by default (ascending)', () => {
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    // Default sort is grade asc → lowest score first
    const rows = screen.getAllByRole('row')
    // First row is header, skip it
    const dataRows = rows.slice(1)
    expect(dataRows.length).toBe(3)

    // Grade column has aria-sort
    const gradeHeader = screen.getByText('Grade').closest('th')
    expect(gradeHeader).toHaveAttribute('aria-sort', 'ascending')
  })

  it('toggles sort direction when clicking the same header', async () => {
    const user = userEvent.setup()
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    const gradeHeader = screen.getByText('Grade').closest('th')!
    expect(gradeHeader).toHaveAttribute('aria-sort', 'ascending')

    await user.click(gradeHeader)
    expect(gradeHeader).toHaveAttribute('aria-sort', 'descending')

    await user.click(gradeHeader)
    expect(gradeHeader).toHaveAttribute('aria-sort', 'ascending')
  })

  it('changes sort field when clicking a different header', async () => {
    const user = userEvent.setup()
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    const nameHeader = screen.getByText('Package').closest('th')!
    await user.click(nameHeader)

    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    // Previous sort column should become none
    const gradeHeader = screen.getByText('Grade').closest('th')!
    expect(gradeHeader).toHaveAttribute('aria-sort', 'none')
  })

  it('filters dependencies by search text', async () => {
    const user = userEvent.setup()
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    const searchInput = screen.getByLabelText('Filter packages by name')
    await user.type(searchInput, 'react')

    expect(screen.getByText('react')).toBeInTheDocument()
    expect(screen.queryByText('vue')).not.toBeInTheDocument()
    expect(screen.queryByText('next')).not.toBeInTheDocument()
  })

  it('shows "No dependencies match" when filter matches nothing', async () => {
    const user = userEvent.setup()
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    const searchInput = screen.getByLabelText('Filter packages by name')
    await user.type(searchInput, 'nonexistent')

    expect(screen.getByText(/No dependencies match/)).toBeInTheDocument()
  })

  it('calls onSelectDep when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelectDep = vi.fn()

    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={onSelectDep}
      />,
    )

    // Click on "react" row
    const reactRow = screen.getByText('react').closest('tr')!
    await user.click(reactRow)

    expect(onSelectDep).toHaveBeenCalledOnce()
    expect(onSelectDep.mock.calls[0][0].packageName).toBe('react')
  })

  it('hides dev dependencies when dev toggle is unchecked', async () => {
    const user = userEvent.setup()
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    // vue is a dev dep — should be visible initially
    expect(screen.getByText('vue')).toBeInTheDocument()

    // Uncheck "Show dev deps"
    const devCheckbox = screen.getByLabelText(/Show dev deps/)
    await user.click(devCheckbox)

    expect(screen.queryByText('vue')).not.toBeInTheDocument()
    expect(screen.getByText('react')).toBeInTheDocument()
    expect(screen.getByText('next')).toBeInTheDocument()
  })

  it('shows count of filtered vs total deps', () => {
    render(
      <DepsTable
        deps={defaultDeps}
        depTypes={defaultDepTypes}
        onSelectDep={vi.fn()}
      />,
    )

    expect(screen.getByText('3 of 3')).toBeInTheDocument()
  })

  it('labels an unresolved manifest range and shows unknown CVE status', () => {
    render(
      <DepsTable
        deps={[makeDep('react', {
          dependencyKey: 'react@range:^19.0.0',
          currentVersion: '^19.0.0',
          requestedRange: '^19.0.0',
          installedVersion: null,
          versionSource: 'manifest',
          cveCount: null,
          score: null,
          grade: null,
        })]}
        depTypes={new Map([['react@range:^19.0.0', 'production']])}
        onSelectDep={vi.fn()}
      />,
    )

    expect(screen.getByText('range')).toBeInTheDocument()
    expect(screen.getByLabelText('CVE status unknown')).toHaveTextContent('?')
    expect(screen.getByLabelText('Health grade: unknown')).toHaveTextContent('?')
  })

  it('renders distinct installed versions of the same package as separate rows', () => {
    render(
      <DepsTable
        deps={[
          makeDep('react', { dependencyKey: 'react@18.3.1', currentVersion: '18.3.1', installedVersion: '18.3.1' }),
          makeDep('react', { dependencyKey: 'react@19.1.1', currentVersion: '19.1.1', installedVersion: '19.1.1' }),
        ]}
        depTypes={new Map([
          ['react@18.3.1', 'production'],
          ['react@19.1.1', 'production'],
        ])}
        onSelectDep={vi.fn()}
      />,
    )

    expect(screen.getAllByText('react')).toHaveLength(2)
    expect(screen.getByText('18.3.1')).toBeInTheDocument()
    expect(screen.getByText('19.1.1')).toBeInTheDocument()
  })
})
