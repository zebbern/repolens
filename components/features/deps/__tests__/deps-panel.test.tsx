import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DepsPanel } from '../deps-panel'
import type { CodeIndex } from '@/lib/code/code-index'
import type { NpmPackageMeta } from '@/lib/deps/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockParseDependencies = vi.fn()
const mockParseDependenciesAsync = vi.fn()
const mockParseDependenciesAsyncWithCoverage = vi.fn()
const mockQueryOSV = vi.fn()
const mockFetchDependencyMeta = vi.fn()
const repositoryHarness = vi.hoisted(() => {
  const harness = {
    session: { id: 1, signal: new AbortController().signal },
    isCurrent: (session: unknown) => session === harness.session,
    tabCache: new Map<string, unknown>(),
  }
  return harness
})

vi.mock('@/lib/code/scanner/cve-lookup', () => ({
  parseDependencies: (...args: unknown[]) => mockParseDependencies(...args),
  parseDependenciesAsync: (...args: unknown[]) => mockParseDependenciesAsync(...args),
  parseDependenciesAsyncWithCoverage: (...args: unknown[]) => mockParseDependenciesAsyncWithCoverage(...args),
  queryOSV: (...args: unknown[]) => mockQueryOSV(...args),
  dependencyIdentityKey: (dep: {
    name: string
    version: string
    requestedRange?: string
    installedVersion?: string | null
    workspace?: string
  }) => {
    const workspace = (dep.workspace ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
    const version = dep.installedVersion
      ? `exact:${dep.installedVersion}`
      : `range:${dep.requestedRange ?? dep.version}`
    return `${workspace}\u0000${dep.name}\u0000${version}`
  },
  // Faithful identity-level dedupe; exact version variants remain distinct.
  dedupeDependencies: (deps: Array<{
    name: string
    version: string
    requestedRange?: string
    installedVersion?: string | null
    workspace?: string
    type: string
  }>) => {
    const byIdentity = new Map<string, (typeof deps)[number]>()
    for (const dep of deps) {
      const workspace = (dep.workspace ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
      const version = dep.installedVersion
        ? `exact:${dep.installedVersion}`
        : `range:${dep.requestedRange ?? dep.version}`
      const key = `${workspace}\u0000${dep.name}\u0000${version}`
      const existing = byIdentity.get(key)
      if (!existing) byIdentity.set(key, { ...dep })
      else if (existing.type === 'dev' && dep.type === 'production') existing.type = 'production'
    }
    return Array.from(byIdentity.values())
  },
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
  DepsTable: ({ deps, depTypes, onSelectDep }: {
    deps: unknown[]
    depTypes: Map<string, 'production' | 'dev'>
    onSelectDep: (d: unknown) => void
  }) => (
    <div data-testid="deps-table">
      Table: {(deps as Array<{ packageName: string }>).length} deps
      {(deps as Array<{
        dependencyKey: string
        packageName: string
        currentVersion: string
        cveCount: number | null
        grade: string | null
        error?: string
      }>).map(d => (
        <button
          key={d.dependencyKey}
          data-current-version={d.currentVersion}
          data-cve-count={d.cveCount ?? 'unknown'}
          data-grade={d.grade ?? 'unknown'}
          data-error={d.error ?? ''}
          data-dependency-type={depTypes.get(d.dependencyKey) ?? 'production'}
          onClick={() => onSelectDep(d)}
        >
          {d.packageName}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('../deps-detail-drawer', () => ({
  DepsDetailDrawer: ({ isOpen }: { dep: unknown; isOpen: boolean }) =>
    isOpen ? <div data-testid="deps-drawer">Drawer open</div> : null,
}))

// Mock tooltip provider
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/providers', () => {
  const getTabCache = vi.fn((key: string) => repositoryHarness.tabCache.get(key))
  const setTabCache = vi.fn((key: string, value: unknown) => {
    repositoryHarness.tabCache.set(key, value)
  })
  return {
    useRepository: () => ({
      getTabCache,
      setTabCache,
    }),
    useRepositoryActions: () => ({
      getTabCache,
      setTabCache,
      isRepositorySessionCurrent: repositoryHarness.isCurrent,
    }),
    useRepositoryData: () => ({ repositorySession: repositoryHarness.session }),
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

function makeCveResult(packageName: string, version: string, cveId = 'CVE-1') {
  return {
    packageName,
    version,
    advisoryId: cveId,
    cveId,
    aliases: [cveId],
    summary: 'Test vulnerability',
    severity: 'high' as const,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DepsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseDependencies.mockReset()
    mockParseDependenciesAsync.mockReset()
    mockParseDependenciesAsync.mockImplementation(async (...args: unknown[]) => mockParseDependencies(...args))
    mockParseDependenciesAsyncWithCoverage.mockReset()
    mockParseDependenciesAsyncWithCoverage.mockImplementation(async (...args: unknown[]) => ({
      dependencies: mockParseDependencies(...args) ?? [],
      status: 'complete',
      manifests: [],
    }))
    mockFetchDependencyMeta.mockReset()
    mockQueryOSV.mockResolvedValue({ results: [], errors: [] })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_input, init) => {
      const packages = JSON.parse(String(init?.body)).packages as unknown[]
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [], errors: [], scannedPackages: packages.length }),
      }
    }))
    repositoryHarness.session = { id: 1, signal: new AbortController().signal }
    repositoryHarness.tabCache.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears and rejects dependency publication when the session switches to an empty repository', async () => {
    let resolve!: (value: Map<string, NpmPackageMeta>) => void
    mockParseDependencies.mockReturnValue([{ name: 'react', version: '18.0.0', type: 'production' }])
    mockFetchDependencyMeta.mockReturnValue(new Promise(done => { resolve = done }))
    const { rerender } = render(<DepsPanel codeIndex={makeCodeIndex()} />)

    repositoryHarness.session = { id: 2, signal: new AbortController().signal }
    rerender(<DepsPanel codeIndex={makeCodeIndex(0)} />)
    resolve(new Map([['react', makeMeta('react')]]))

    await waitFor(() => expect(screen.queryByTestId('deps-summary')).not.toBeInTheDocument())
    expect(screen.queryByTestId('deps-table')).not.toBeInTheDocument()
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
    mockParseDependenciesAsyncWithCoverage.mockResolvedValue({
      dependencies: [],
      status: 'missing',
      manifests: [],
    })

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => {
      expect(screen.getByText('No package.json found')).toBeInTheDocument()
    })
  })

  it('rejects an older load after the code index changes within one repository session', async () => {
    const firstParse = deferred<{
      dependencies: Array<{ name: string; version: string; type: 'production' }>
      status: 'complete'
      manifests: []
    }>()
    mockParseDependenciesAsyncWithCoverage
      .mockReturnValueOnce(firstParse.promise)
      .mockResolvedValueOnce({
        dependencies: [{ name: 'current-package', version: '^2.0.0', type: 'production' }],
        status: 'complete',
        manifests: [],
      })
    mockFetchDependencyMeta.mockImplementation(async (names: string[]) => new Map(
      names.map(name => [name, makeMeta(name)]),
    ))
    const { rerender } = render(<DepsPanel codeIndex={makeCodeIndex()} />)
    await waitFor(() => expect(mockParseDependenciesAsyncWithCoverage).toHaveBeenCalledOnce())

    rerender(<DepsPanel codeIndex={makeCodeIndex()} />)
    expect(await screen.findByRole('button', { name: 'current-package' })).toBeInTheDocument()

    await act(async () => {
      firstParse.resolve({
        dependencies: [{ name: 'stale-package', version: '^1.0.0', type: 'production' }],
        status: 'complete',
        manifests: [],
      })
      await firstParse.promise
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'current-package' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'stale-package' })).not.toBeInTheDocument()
    })
  })

  it('does not render the prior repository publication during a source change', async () => {
    const nextParse = deferred<{
      dependencies: Array<{ name: string; version: string; type: 'production' }>
      status: 'complete'
      manifests: []
    }>()
    mockParseDependenciesAsyncWithCoverage
      .mockResolvedValueOnce({
        dependencies: [{ name: 'private-old-package', version: '^1', type: 'production' }],
        status: 'complete',
        manifests: [],
      })
      .mockReturnValueOnce(nextParse.promise)
    mockFetchDependencyMeta.mockImplementation(async (names: string[]) => new Map(
      names.map(name => [name, makeMeta(name)]),
    ))
    const { rerender } = render(<DepsPanel codeIndex={makeCodeIndex()} />)
    expect(await screen.findByRole('button', { name: 'private-old-package' })).toBeInTheDocument()

    repositoryHarness.session = { id: 2, signal: new AbortController().signal }
    rerender(<DepsPanel codeIndex={makeCodeIndex()} />)

    expect(screen.queryByRole('button', { name: 'private-old-package' })).not.toBeInTheDocument()
    expect(screen.getByText('Analyzing dependencies…')).toBeInTheDocument()
  })

  it('accepts the content revision produced while hydrating a lazy manifest', async () => {
    const codeIndex = makeCodeIndex()
    const contentStore = { contentRevision: 0 }
    const parseResult = {
      dependencies: [{ name: 'react', version: '^19', type: 'production' as const }],
      status: 'complete' as const,
      manifests: [{ path: 'package.json', status: 'loaded' as const }],
    }
    const firstParse = deferred<typeof parseResult>()
    Object.assign(codeIndex, { contentStore })
    mockParseDependenciesAsyncWithCoverage
      .mockReturnValueOnce(firstParse.promise)
      .mockResolvedValue(parseResult)
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))

    render(<DepsPanel codeIndex={codeIndex} />)
    await waitFor(() => expect(mockParseDependenciesAsyncWithCoverage).toHaveBeenCalledOnce())
    await act(async () => {
      contentStore.contentRevision++
      firstParse.resolve(parseResult)
      await firstParse.promise
    })

    expect(await screen.findByRole('button', { name: 'react' })).toBeInTheDocument()
  })

  it('restarts analysis when the store revision changes after dependency parsing', async () => {
    const codeIndex = makeCodeIndex()
    const contentStore = { contentRevision: 0 }
    const metadata = deferred<Map<string, ReturnType<typeof makeMeta>>>()
    Object.assign(codeIndex, { contentStore })
    mockParseDependenciesAsyncWithCoverage.mockResolvedValue({
      dependencies: [{ name: 'react', version: '^19', type: 'production' }],
      status: 'complete',
      manifests: [{ path: 'package.json', status: 'loaded' }],
    })
    mockFetchDependencyMeta
      .mockReturnValueOnce(metadata.promise)
      .mockResolvedValue(new Map([['react', makeMeta('react')]]))

    render(<DepsPanel codeIndex={codeIndex} />)
    await waitFor(() => expect(mockFetchDependencyMeta).toHaveBeenCalledOnce())

    await act(async () => {
      contentStore.contentRevision++
      metadata.resolve(new Map([['react', makeMeta('react')]]))
      await metadata.promise
    })

    expect(await screen.findByRole('button', { name: 'react' })).toBeInTheDocument()
    expect(mockParseDependenciesAsyncWithCoverage).toHaveBeenCalledTimes(2)
  })

  it('aborts an active CVE request when the code index changes', async () => {
    mockParseDependencies.mockReturnValue([{
      name: 'react',
      version: '19.1.1',
      requestedRange: '^19',
      installedVersion: '19.1.1',
      type: 'production',
    }])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))
    let firstSignal: AbortSignal | undefined
    vi.mocked(globalThis.fetch).mockImplementationOnce((_input, init) => {
      firstSignal = init?.signal as AbortSignal
      return new Promise(() => {})
    })
    const { rerender } = render(<DepsPanel codeIndex={makeCodeIndex()} />)
    await waitFor(() => expect(firstSignal).toBeDefined())

    rerender(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(firstSignal?.aborted).toBe(true))
  })

  it('does not reuse dependency results from a different code index revision', async () => {
    const cachedIndex = makeCodeIndex()
    repositoryHarness.tabCache.set('deps', {
      codeIndex: cachedIndex,
      contentRevision: 0,
      healthData: [{
        dependencyKey: 'cached-package',
        packageName: 'cached-package',
        currentVersion: '1.0.0',
        cveCount: 0,
        grade: 'A',
      }],
      depTypes: new Map(),
      cveResults: [],
    })
    mockParseDependencies.mockReturnValue([
      { name: 'current-package', version: '^2.0.0', type: 'production' },
    ])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['current-package', makeMeta('current-package')]]))

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    expect(await screen.findByRole('button', { name: 'current-package' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'cached-package' })).not.toBeInTheDocument()
    expect(mockParseDependenciesAsyncWithCoverage).toHaveBeenCalledOnce()
  })

  it('shows a valid empty state when a readable manifest declares no dependencies', async () => {
    mockParseDependenciesAsyncWithCoverage.mockResolvedValue({
      dependencies: [],
      status: 'complete',
      manifests: [{ path: 'package.json', status: 'loaded' }],
    })

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => {
      expect(screen.getByText('No dependencies found')).toBeInTheDocument()
    })
    expect(screen.queryByText('Failed to analyze dependencies')).not.toBeInTheDocument()
    expect(screen.queryByText('No package.json found')).not.toBeInTheDocument()
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
      {
        name: 'react',
        version: '18.0.0',
        requestedRange: '^18.0.0',
        installedVersion: '18.0.0',
        type: 'production',
      },
    ])
    mockFetchDependencyMeta.mockResolvedValue(
      new Map([['react', makeMeta('react')]]),
    )
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('OSV down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => {
      // Should still render successfully even if CVE lookup fails
      expect(screen.getByTestId('deps-summary')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'react' })).toHaveAttribute('data-error', 'OSV down')

    warnSpy.mockRestore()
  })

  it('shows a manifest error instead of claiming no package.json when parsing fails', async () => {
    mockParseDependenciesAsyncWithCoverage.mockResolvedValue({
      dependencies: [],
      status: 'error',
      manifests: [{ path: 'package.json', status: 'malformed', error: 'Manifest contains invalid JSON' }],
    })

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByText('Failed to analyze dependencies')).toBeInTheDocument())
    expect(screen.getByText(/package.json/)).toBeInTheDocument()
    expect(screen.queryByText('No package.json found')).not.toBeInTheDocument()
  })

  it('keeps parsed dependencies visible while reporting partial manifest coverage', async () => {
    mockParseDependenciesAsyncWithCoverage.mockResolvedValue({
      dependencies: [{ name: 'react', version: '18.0.0', type: 'production' }],
      status: 'partial',
      manifests: [
        { path: 'package.json', status: 'loaded' },
        { path: 'packages/app/package.json', status: 'malformed', error: 'Manifest contains invalid JSON' },
      ],
    })
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByTestId('deps-table')).toBeInTheDocument())
    expect(screen.getByText(/Dependency coverage incomplete/)).toBeInTheDocument()
    expect(screen.getByText(/packages\/app\/package.json/)).toBeInTheDocument()
  })

  it('reports an unavailable lockfile as incomplete dependency coverage', async () => {
    mockParseDependenciesAsyncWithCoverage.mockResolvedValue({
      dependencies: [{ name: 'react', version: '^18.0.0', type: 'production' }],
      status: 'partial',
      manifests: [{ path: 'package.json', status: 'loaded' }],
      lockfiles: [
        { path: 'package-lock.json', status: 'unavailable', error: 'Lockfile content is unavailable' },
      ],
    })
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByTestId('deps-table')).toBeInTheDocument())
    expect(screen.getByText(/Dependency coverage incomplete/)).toBeInTheDocument()
    expect(screen.getByText(/package-lock\.json/)).toBeInTheDocument()
  })

  it('queries CVEs only for exact installed versions and marks ranges unknown', async () => {
    mockParseDependencies.mockReturnValue([
      {
        name: 'react',
        version: '19.1.1',
        requestedRange: '^19.0.0',
        installedVersion: '19.1.1',
        type: 'production',
      },
      {
        name: 'vue',
        version: '^3.5.0',
        requestedRange: '^3.5.0',
        installedVersion: null,
        type: 'production',
      },
    ])
    mockFetchDependencyMeta.mockResolvedValue(new Map([
      ['react', makeMeta('react')],
      ['vue', makeMeta('vue')],
    ]))

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByTestId('deps-table')).toBeInTheDocument())
    const request = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      packages: [{ name: 'react', version: '19.1.1', type: 'production' }],
    })
    expect(screen.getByRole('button', { name: 'react' })).toHaveAttribute('data-current-version', '19.1.1')
    expect(screen.getByRole('button', { name: 'vue' })).toHaveAttribute('data-current-version', '^3.5.0')
    expect(screen.getByRole('button', { name: 'vue' })).toHaveAttribute('data-cve-count', 'unknown')
    expect(screen.getByRole('button', { name: 'vue' })).toHaveAttribute('data-grade', 'unknown')
  })

  it('keeps every CVE request within the 20-package API contract', async () => {
    const dependencies = Array.from({ length: 21 }, (_, index) => ({
      name: `pkg-${index}`,
      version: '1.0.0',
      requestedRange: '^1.0.0',
      installedVersion: '1.0.0',
      type: 'production' as const,
    }))
    mockParseDependencies.mockReturnValue(dependencies)
    mockFetchDependencyMeta.mockResolvedValue(new Map(
      dependencies.map(dep => [dep.name, makeMeta(dep.name)]),
    ))

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    const batchSizes = vi.mocked(globalThis.fetch).mock.calls.map(([, init]) => (
      JSON.parse(String(init?.body)) as { packages: unknown[] }
    ).packages.length)
    expect(batchSizes).toEqual([20, 1])
  })

  it('cancels CVE requests with the repository session', async () => {
    const sessionController = new AbortController()
    repositoryHarness.session = { id: 1, signal: sessionController.signal }
    mockParseDependencies.mockReturnValue([{
      name: 'react',
      version: '19.1.1',
      requestedRange: '^19.0.0',
      installedVersion: '19.1.1',
      type: 'production',
    }])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))
    vi.mocked(globalThis.fetch).mockImplementation(() => new Promise(() => {}))

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce())
    const requestSignal = vi.mocked(globalThis.fetch).mock.calls[0][1]?.signal as AbortSignal
    expect(requestSignal.aborted).toBe(false)
    sessionController.abort()
    expect(requestSignal.aborted).toBe(true)
  })

  it('limits dependency enrichment to the 60-package workflow budget', async () => {
    const dependencies = Array.from({ length: 61 }, (_, index) => ({
      name: `pkg-${index}`,
      version: '1.0.0',
      requestedRange: '^1.0.0',
      installedVersion: '1.0.0',
      type: 'production' as const,
    }))
    mockParseDependencies.mockReturnValue(dependencies)
    mockFetchDependencyMeta.mockResolvedValue(new Map(
      dependencies.slice(0, 60).map(dep => [dep.name, makeMeta(dep.name)]),
    ))

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByTestId('deps-table')).toBeInTheDocument())
    expect(mockFetchDependencyMeta.mock.calls[0][0]).toHaveLength(60)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: 'pkg-0' })).toHaveAttribute('data-cve-count', '0')
    expect(screen.getByRole('button', { name: 'pkg-60' })).toHaveAttribute('data-cve-count', 'unknown')
    expect(screen.getByRole('button', { name: 'pkg-60' })).toHaveAttribute('data-grade', 'unknown')
  })

  it('keeps successful CVE batches known when a later batch fails', async () => {
    const dependencies = Array.from({ length: 21 }, (_, index) => ({
      name: `pkg-${index}`,
      version: '1.0.0',
      requestedRange: '^1.0.0',
      installedVersion: '1.0.0',
      type: 'production' as const,
    }))
    mockParseDependencies.mockReturnValue(dependencies)
    mockFetchDependencyMeta.mockResolvedValue(new Map(
      dependencies.map(dep => [dep.name, makeMeta(dep.name)]),
    ))
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [], errors: [], scannedPackages: 20 }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByTestId('deps-table')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'pkg-0' })).toHaveAttribute('data-cve-count', '0')
    expect(screen.getByRole('button', { name: 'pkg-20' })).toHaveAttribute('data-cve-count', 'unknown')
  })

  it('marks a dependency unknown when the CVE proxy reports an incomplete successful batch', async () => {
    mockParseDependencies.mockReturnValue([{
      name: 'react',
      version: '19.1.1',
      requestedRange: '^19',
      installedVersion: '19.1.1',
      type: 'production',
    }])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [], errors: [], scannedPackages: 0 }),
    } as Response)

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    const row = await screen.findByRole('button', { name: 'react' })
    expect(row).toHaveAttribute('data-cve-count', 'unknown')
    expect(row).toHaveAttribute('data-error', expect.stringMatching(/incomplete/i))
  })

  it('rejects a CVE proxy result for a package outside the requested batch', async () => {
    mockParseDependencies.mockReturnValue([{
      name: 'react',
      version: '19.1.1',
      requestedRange: '^19',
      installedVersion: '19.1.1',
      type: 'production',
    }])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [makeCveResult('other', '1.0.0')],
        errors: [],
        scannedPackages: 1,
      }),
    } as Response)

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    const row = await screen.findByRole('button', { name: 'react' })
    expect(row).toHaveAttribute('data-cve-count', 'unknown')
    expect(row).toHaveAttribute('data-error', expect.stringMatching(/malformed|unexpected/i))
  })

  it('keeps separate rows and CVE counts for distinct exact versions', async () => {
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '18.3.1', requestedRange: '^18', installedVersion: '18.3.1', type: 'production' },
      { name: 'react', version: '19.1.1', requestedRange: '^19', installedVersion: '19.1.1', type: 'production' },
    ])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [makeCveResult('react', '18.3.1')],
        errors: [],
        scannedPackages: 2,
      }),
    } as Response)

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'react' })).toHaveLength(2))
    const rows = screen.getAllByRole('button', { name: 'react' })
    expect(rows.find(row => row.dataset.currentVersion === '18.3.1')).toHaveAttribute('data-cve-count', '1')
    expect(rows.find(row => row.dataset.currentVersion === '19.1.1')).toHaveAttribute('data-cve-count', '0')
  })

  it('keeps same-version dependencies from distinct workspaces with independent types', async () => {
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '19.1.1', requestedRange: '^19', installedVersion: '19.1.1', workspace: 'packages/a', type: 'dev' },
      { name: 'react', version: '19.1.1', requestedRange: '^19', installedVersion: '19.1.1', workspace: 'packages/b', type: 'production' },
    ])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))
    vi.mocked(globalThis.fetch).mockImplementation(async (_input, init) => {
      const packages = JSON.parse(String(init?.body)).packages as Array<{ name: string; version: string }>
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: packages.map(dep => makeCveResult(dep.name, dep.version)),
          errors: [],
          scannedPackages: packages.length,
        }),
      } as Response
    })

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'react' })).toHaveLength(2))
    const rows = screen.getAllByRole('button', { name: 'react' })
    expect(rows.map(row => row.dataset.dependencyType)).toEqual(['dev', 'production'])
    expect(rows.map(row => row.dataset.cveCount)).toEqual(['1', '1'])
    const request = vi.mocked(globalThis.fetch).mock.calls[0][1]
    expect(JSON.parse(String(request?.body)).packages).toHaveLength(1)
  })

  it('enriches an npm alias through its canonical registry identity', async () => {
    mockParseDependencies.mockReturnValue([{
      name: 'express4',
      registryName: 'express',
      version: '4.18.2',
      requestedRange: '^4.18.0',
      installedVersion: '4.18.2',
      type: 'production',
    }])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['express', makeMeta('express')]]))
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [makeCveResult('express', '4.18.2', 'CVE-alias')],
        errors: [],
        scannedPackages: 1,
      }),
    } as Response)

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    const row = await screen.findByRole('button', { name: 'express4' })
    expect(mockFetchDependencyMeta.mock.calls[0][0]).toEqual(['express'])
    const request = vi.mocked(globalThis.fetch).mock.calls[0][1]
    expect(JSON.parse(String(request?.body)).packages).toEqual([
      { name: 'express', version: '4.18.2', type: 'production' },
    ])
    expect(row).toHaveAttribute('data-cve-count', '1')
  })

  it('withholds the grade when publish-date metadata is unavailable', async () => {
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '19.1.1', requestedRange: '^19', installedVersion: '19.1.1', type: 'production' },
    ])
    mockFetchDependencyMeta.mockResolvedValue(new Map([
      ['react', { ...makeMeta('react'), lastPublish: null }],
    ]))

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'react' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'react' })).toHaveAttribute('data-grade', 'unknown')
  })

  it('keeps npm errors visible when metadata is available', async () => {
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '19.1.1', requestedRange: '^19', installedVersion: '19.1.1', type: 'production' },
    ])
    mockFetchDependencyMeta.mockImplementation(async (
      _packages: string[],
      options?: { onError?: (packageName: string, message: string) => void },
    ) => {
      options?.onError?.('react', 'npm registry unavailable')
      return new Map([['react', makeMeta('react')]])
    })

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'react' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'react' })).toHaveAttribute('data-error', 'npm registry unavailable')
  })

  it('keeps OSV errors visible when metadata is available', async () => {
    mockParseDependencies.mockReturnValue([
      { name: 'react', version: '19.1.1', requestedRange: '^19', installedVersion: '19.1.1', type: 'production' },
    ])
    mockFetchDependencyMeta.mockResolvedValue(new Map([['react', makeMeta('react')]]))
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 503 } as Response)

    render(<DepsPanel codeIndex={makeCodeIndex()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'react' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'react' })).toHaveAttribute('data-error', 'CVE lookup returned 503')
  })
})
