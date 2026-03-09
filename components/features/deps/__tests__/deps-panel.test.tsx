import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DepsPanel } from '../deps-panel'
import type { CodeIndex } from '@/lib/code/code-index'
import type { NpmPackageMeta } from '@/lib/deps/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockParseDependencies = vi.fn()
const mockQueryOSV = vi.fn()
const mockFetchDependencyMeta = vi.fn()

vi.mock('@/lib/code/scanner/cve-lookup', () => ({
  parseDependencies: (...args: unknown[]) => mockParseDependencies(...args),
  queryOSV: (...args: unknown[]) => mockQueryOSV(...args),
}))

vi.mock('@/lib/deps/npm-client', () => ({
  fetchDependencyMeta: (...args: unknown[]) => mockFetchDependencyMeta(...args),
}))

// Mock child components to simplify testing
vi.mock('../deps-summary', () => ({
  DepsSummary: ({ deps }: { deps: unknown[] }) => (
    <div data-testid="deps-summary">Summary: {deps.length} deps</div>
  ),
}))

vi.mock('../deps-table', () => ({
  DepsTable: ({ deps, onSelectDep }: { deps: unknown[]; onSelectDep: (d: unknown) => void }) => (
    <div data-testid="deps-table">
      Table: {(deps as Array<{ packageName: string }>).length} deps
      {(deps as Array<{ packageName: string }>).map(d => (
        <button key={d.packageName} onClick={() => onSelectDep(d)}>
          {d.packageName}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('../deps-detail-drawer', () => ({
  DepsDetailDrawer: ({ dep, isOpen }: { dep: unknown; isOpen: boolean }) =>
    isOpen ? <div data-testid="deps-drawer">Drawer open</div> : null,
}))

// Mock tooltip provider
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/providers', () => {
  const getTabCache = vi.fn(() => undefined)
  const setTabCache = vi.fn()
  return {
    useRepository: () => ({
      getTabCache,
      setTabCache,
    }),
    useRepositoryActions: () => ({
      getTabCache,
      setTabCache,
    }),
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCodeIndex(totalFiles = 5): CodeIndex {
  return {
    totalFiles,
    files: new Map(),
    symbols: [],
    search: vi.fn(),
    getFile: vi.fn(),
    getSymbolsForFile: vi.fn(),
  } as unknown as CodeIndex
}

function makeMeta(name: string): NpmPackageMeta {
  return {
    name,
    version: '2.0.0',
    description: `Package ${name}`,
    license: 'MIT',
    maintainers: 1,
    lastPublish: '2026-03-01T00:00:00Z',
    weeklyDownloads: 50_000,
    downloadTrend: [],
    deprecated: false,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DepsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryOSV.mockResolvedValue({ results: [], errors: [] })
  })

  it('shows loading state while fetching', () => {
    // parseDependencies returns deps, but fetchMeta never resolves
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '^18.0.0', type: 'production' },
    ])
    mockFetchDependencyMeta.mockReturnValue(new Promise(() => {})) // never resolves

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    expect(screen.getByText('Analyzing dependencies…')).toBeInTheDocument()
  })

  it('shows empty state when no package.json is found', async () => {
    mockParseDependencies.mockReturnValue([])

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => {
      expect(screen.getByText('No package.json found')).toBeInTheDocument()
    })
  })

  it('shows error state when API call fails', async () => {
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '^18.0.0', type: 'production' },
    ])
    mockFetchDependencyMeta.mockRejectedValue(new Error('Network failure'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => {
      expect(screen.getByText('Failed to analyze dependencies')).toBeInTheDocument()
    })
    expect(screen.getByText('Network failure')).toBeInTheDocument()
    errorSpy.mockRestore()
  })

  it('renders summary and table when data loads successfully', async () => {
    const reactMeta = makeMeta('react')
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '^18.0.0', type: 'production' },
    ])
    mockFetchDependencyMeta.mockResolvedValue(
      new Map([['react', reactMeta]]),
    )

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => {
      expect(screen.getByTestId('deps-summary')).toBeInTheDocument()
      expect(screen.getByTestId('deps-table')).toBeInTheDocument()
    })
  })

  it('retry button re-fetches dependencies', async () => {
    const user = userEvent.setup()
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '^18.0.0', type: 'production' },
    ])
    // First call fails
    mockFetchDependencyMeta.mockRejectedValueOnce(new Error('Temporary failure'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => {
      expect(screen.getByText('Failed to analyze dependencies')).toBeInTheDocument()
    })

    // Setup second call to succeed
    const reactMeta = makeMeta('react')
    mockFetchDependencyMeta.mockResolvedValueOnce(
      new Map([['react', reactMeta]]),
    )

    const retryButton = screen.getByText('Retry')
    await user.click(retryButton)

    await waitFor(() => {
      expect(screen.getByTestId('deps-summary')).toBeInTheDocument()
    })

    errorSpy.mockRestore()
  })

  it('does not load if codeIndex has 0 total files', () => {
    render(<DepsPanel codeIndex={makeCodeIndex(0)} />)

    // Should stay in idle/loading state without calling parseDependencies
    expect(mockParseDependencies).not.toHaveBeenCalled()
  })

  it('handles CVE lookup failure gracefully (non-fatal)', async () => {
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '^18.0.0', type: 'production' },
    ])
    mockFetchDependencyMeta.mockResolvedValue(
      new Map([['react', makeMeta('react')]]),
    )
    mockQueryOSV.mockRejectedValue(new Error('OSV down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => {
      // Should still render successfully even if CVE lookup fails
      expect(screen.getByTestId('deps-summary')).toBeInTheDocument()
    })

    warnSpy.mockRestore()
  })
})
