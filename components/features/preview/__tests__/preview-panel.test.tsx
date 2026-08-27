import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangeEvent } from 'react'

interface LandingPageProps {
  onConnect: () => void
  repoUrl: string
  onRepoUrlChange: (url: string) => void
}

interface PreviewTabBarProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

interface GlobalSearchOverlayProps {
  allFiles: Array<{ path: string }>
  onSelect: (path: string) => void
}

// ---------------------------------------------------------------------------
// Provider mock — default returns with API key present
// ---------------------------------------------------------------------------
const mockUseApp = vi.fn(() => ({
  previewUrl: null,
  isGenerating: false,
}))

const mockUseRepository = vi.fn(() => ({
  repo: null,
  files: [],
  isLoading: false,
  error: null,
  connectRepository: vi.fn(),
  disconnectRepository: vi.fn(),
  codeIndex: { totalFiles: 0, files: new Map() },
  loadingStage: 'idle',
  indexingProgress: 0,
  isCacheHit: false,
}))

const mockGetValidProviders = vi.fn(() => ['openai'])
const mockFlattenFiles = vi.fn((files?: unknown) => {
  void files
  return [] as Array<{ path: string; name: string }>
})
const mockCoverage = vi.fn(() => null as null | {
  treeStatus: 'complete' | 'partial'
  supportedFiles: { discovered: number; loaded: number }
  failures: { count: number; samples: Array<{ path: string; error: string }> }
  failedSubtrees: { count: number; samples: string[] }
  mode: 'full' | 'on-demand'
})
const mockUseAPIKeys = vi.fn(() => ({
  getValidProviders: mockGetValidProviders,
  isHydrated: true,
}))

vi.mock('@/providers', () => ({
  useApp: () => mockUseApp(),
  useRepository: () => mockUseRepository(),
  useRepositoryData: () => {
    const r = mockUseRepository()
    return { repo: r.repo, files: r.files, codeIndex: r.codeIndex, isCacheHit: r.isCacheHit, coverage: mockCoverage(), parsedFiles: [], codebaseAnalysis: null, failedFiles: [] }
  },
  useRepositoryActions: () => {
    const r = mockUseRepository()
    return { connectRepository: r.connectRepository, disconnectRepository: r.disconnectRepository }
  },
  useRepositoryProgress: () => {
    const r = mockUseRepository()
    return { isLoading: r.isLoading, error: r.error, loadingStage: r.loadingStage, indexingProgress: r.indexingProgress }
  },
  useAPIKeys: () => mockUseAPIKeys(),
  useGitHubToken: () => ({ isHydrated: true }),
}))

vi.mock('@/lib/code/code-index', () => ({
  flattenFiles: (files: unknown) => mockFlattenFiles(files),
}))

vi.mock('@/lib/export', () => ({
  parseShareableUrl: vi.fn(() => null),
  updateUrlState: vi.fn(),
  clearUrlState: vi.fn(),
}))

// Mock all lazy-loaded components
vi.mock('@/components/features/code/code-browser', () => ({
  CodeBrowser: () => <div>CodeBrowser</div>,
}))
vi.mock('@/components/features/docs/doc-viewer', () => ({
  DocViewer: () => <div>DocViewer</div>,
}))
vi.mock('@/components/features/diagrams/diagram-viewer', () => ({
  DiagramViewer: () => <div>DiagramViewer</div>,
}))
vi.mock('@/components/features/issues/issues-panel', () => ({
  IssuesPanel: () => <div>IssuesPanel</div>,
}))

vi.mock('@/components/features/loading/loading-progress', () => ({
  LoadingProgress: () => <div data-testid="loading-progress">progress</div>,
}))

vi.mock('@/components/features/repo/project-summary', () => ({
  ProjectSummaryPanel: () => <div data-testid="project-summary">project summary</div>,
}))

vi.mock('@/components/features/landing/landing-page', () => ({
  LandingPage: (props: LandingPageProps) => (
    <div data-testid="landing-page">
      <button onClick={props.onConnect}>Connect</button>
      <input
        data-testid="repo-url-input"
        value={props.repoUrl}
        onChange={(event: ChangeEvent<HTMLInputElement>) => props.onRepoUrlChange(event.target.value)}
      />
    </div>
  ),
}))

vi.mock('../default-content', () => ({
  DefaultContent: () => <div data-testid="default-content">default</div>,
}))

vi.mock('../loading-with-status', () => ({
  LoadingWithStatus: () => <div data-testid="loading-status">loading</div>,
}))

vi.mock('../tab-config', () => ({
  PREVIEW_TABS: [
    { id: 'repo', label: 'Overview', icon: null },
    { id: 'issues', label: 'Issues', icon: null },
    { id: 'docs', label: 'Docs', icon: null, requiresAI: true },
    { id: 'diagram', label: 'Diagrams', icon: null },
    { id: 'code', label: 'Code', icon: null },
    { id: 'deps', label: 'Deps', icon: null },
    { id: 'changelog', label: 'Changelog', icon: null, requiresAI: true },
    { id: 'git-history', label: 'Git History', icon: null },
  ],
}))

vi.mock('../global-search-overlay', () => ({
  GlobalSearchOverlay: ({ allFiles, onSelect }: GlobalSearchOverlayProps) => (
    <div data-testid="global-search-files">
      {allFiles.map((file) => <span key={file.path}>{file.path}</span>)}
      <button onClick={() => onSelect('README')}>select-unsupported-file</button>
    </div>
  ),
}))

vi.mock('../preview-repo-header', () => ({
  PreviewRepoHeader: () => <div data-testid="repo-header">header</div>,
}))

vi.mock('../preview-tab-bar', () => ({
  PreviewTabBar: ({ activeTab, onTabChange }: PreviewTabBarProps) => (
    <div data-testid="tab-bar">
      <button onClick={() => onTabChange('issues')}>issues-tab</button>
      <button onClick={() => onTabChange('docs')}>docs-tab</button>
      <button onClick={() => onTabChange('diagram')}>diagram-tab</button>
      <button onClick={() => onTabChange('code')}>code-tab</button>
      <button onClick={() => onTabChange('deps')}>deps-tab</button>
      <button onClick={() => onTabChange('changelog')}>changelog-tab</button>
      <button onClick={() => onTabChange('git-history')}>git-history-tab</button>
      <span>{activeTab}</span>
    </div>
  ),
}))

vi.mock('@/components/features/loading/tab-skeleton', () => ({
  IssuesTabSkeleton: () => <div>issues-skeleton</div>,
  DocsTabSkeleton: () => <div>docs-skeleton</div>,
  DiagramTabSkeleton: () => <div>diagram-skeleton</div>,
  CodeTabSkeleton: () => <div>code-skeleton</div>,
  DepsTabSkeleton: () => <div>deps-skeleton</div>,
  ChangelogTabSkeleton: () => <div>changelog-skeleton</div>,
  GitHistoryTabSkeleton: () => <div>git-history-skeleton</div>,
}))

vi.mock('@/components/features/deps/deps-panel', () => ({
  DepsPanel: () => <div data-testid="deps-panel">DepsPanel</div>,
}))
vi.mock('@/components/features/changelog/changelog-viewer', () => ({
  ChangelogViewer: () => <div data-testid="changelog-viewer">ChangelogViewer</div>,
}))
vi.mock('@/components/features/git-history/git-history-panel', () => ({
  GitHistoryPanel: ({ navigateToFile }: { navigateToFile?: string | null }) => (
    <div data-testid="git-history-panel">{navigateToFile ?? 'none'}</div>
  ),
}))

vi.mock('../ai-feature-empty-state', () => ({
  AIFeatureEmptyState: ({ tabId }: { tabId: string }) => (
    <div data-testid={`ai-empty-state-${tabId}`}>AI feature locked: {tabId}</div>
  ),
}))

vi.mock('@/components/ui/feature-error-boundary', () => ({
  FeatureErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { PreviewPanel } from '../preview-panel'

describe('PreviewPanel', () => {
  const useConnectedRepository = () => {
    mockUseRepository.mockReturnValue({
      repo: {
        owner: 'owner', name: 'repo', fullName: 'owner/repo', description: null,
        defaultBranch: 'main', stars: 0, forks: 0, language: null, topics: [],
        isPrivate: false, url: 'https://github.com/owner/repo', openIssuesCount: 0,
        pushedAt: '2026-01-01T00:00:00Z', license: null,
      },
      files: [],
      isLoading: false,
      error: null,
      connectRepository: vi.fn(),
      disconnectRepository: vi.fn(),
      codeIndex: { totalFiles: 1, files: new Map([['src/index.ts', { path: 'src/index.ts' }]]) },
      loadingStage: 'ready',
      indexingProgress: { current: 1, total: 1, isComplete: true },
      isCacheHit: false,
    } as never)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Re-establish defaults
    mockUseApp.mockReturnValue({ previewUrl: null, isGenerating: false })
    mockUseRepository.mockReturnValue({
      repo: null,
      files: [],
      isLoading: false,
      error: null,
      connectRepository: vi.fn(),
      disconnectRepository: vi.fn(),
      codeIndex: { totalFiles: 0, files: new Map() },
      loadingStage: 'idle',
      indexingProgress: 0,
      isCacheHit: false,
    })
    mockGetValidProviders.mockReturnValue(['openai'])
    mockCoverage.mockReturnValue(null)
    mockUseAPIKeys.mockReturnValue({
      getValidProviders: mockGetValidProviders,
      isHydrated: true,
    })
    mockFlattenFiles.mockReturnValue([])
  })

  it('shows landing page when no repo is connected', () => {
    render(<PreviewPanel />)
    expect(screen.getByTestId('landing-page')).toBeInTheDocument()
  })

  it('accepts a className prop', () => {
    const { container } = render(<PreviewPanel className="custom-class" />)
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('gates lazy tab content before a repository is connected', async () => {
    const user = userEvent.setup()
    render(<PreviewPanel />)

    await user.click(screen.getByText('code-tab'))

    expect(screen.getByText('No repository connected')).toBeInTheDocument()
    expect(screen.queryByText('CodeBrowser')).not.toBeInTheDocument()
  })

  it('shows a terminal state for source-dependent tabs when no supported files exist', async () => {
    const user = userEvent.setup()
    useConnectedRepository()
    mockUseRepository.mockReturnValue({
      ...mockUseRepository(),
      codeIndex: { totalFiles: 0, files: new Map() },
    } as never)
    mockCoverage.mockReturnValue({
      treeStatus: 'complete',
      supportedFiles: { discovered: 0, loaded: 0 },
      failures: { count: 0, samples: [] },
      failedSubtrees: { count: 0, samples: [] },
      mode: 'full',
    })
    render(<PreviewPanel />)

    await user.click(screen.getByText('code-tab'))

    expect(screen.getByText('No supported files found')).toBeInTheDocument()
    expect(screen.queryByText('CodeBrowser')).not.toBeInTheDocument()
  })

  it('excludes unsupported tree files from global search navigation', () => {
    useConnectedRepository()
    mockUseRepository.mockReturnValue({
      ...mockUseRepository(),
      files: [{ path: 'README', name: 'README', type: 'file' }],
      codeIndex: { totalFiles: 0, files: new Map() },
    } as never)
    mockCoverage.mockReturnValue({
      treeStatus: 'complete',
      supportedFiles: { discovered: 0, loaded: 0 },
      failures: { count: 0, samples: [] },
      failedSubtrees: { count: 0, samples: [] },
      mode: 'full',
    })
    mockFlattenFiles.mockReturnValue([{ path: 'README', name: 'README' }])
    render(<PreviewPanel />)

    act(() => window.dispatchEvent(new Event('open-file-search')))

    expect(screen.getByTestId('global-search-files').querySelector('span')).toBeNull()
  })

  it('does not carry an unsupported search selection into Git History', async () => {
    const user = userEvent.setup()
    useConnectedRepository()
    mockUseRepository.mockReturnValue({
      ...mockUseRepository(),
      files: [{ path: 'README', name: 'README', type: 'file' }],
      codeIndex: { totalFiles: 0, files: new Map() },
    } as never)
    mockCoverage.mockReturnValue({
      treeStatus: 'complete',
      supportedFiles: { discovered: 0, loaded: 0 },
      failures: { count: 0, samples: [] },
      failedSubtrees: { count: 0, samples: [] },
      mode: 'full',
    })
    mockFlattenFiles.mockReturnValue([{ path: 'README', name: 'README' }])
    render(<PreviewPanel />)
    act(() => window.dispatchEvent(new Event('open-file-search')))

    await user.click(screen.getByText('select-unsupported-file'))
    await user.click(screen.getByText('git-history-tab'))

    expect(await screen.findByTestId('git-history-panel')).toHaveTextContent('none')
  })

  describe('AI tab conditional rendering — no API key', () => {
    beforeEach(() => {
      useConnectedRepository()
      mockGetValidProviders.mockReturnValue([])
      mockUseAPIKeys.mockReturnValue({
        getValidProviders: mockGetValidProviders,
        isHydrated: true,
      })
    })

    it('shows AIFeatureEmptyState for docs tab when no API key', async () => {
      const user = userEvent.setup()
      render(<PreviewPanel />)

      await user.click(screen.getByText('docs-tab'))
      expect(screen.getByTestId('ai-empty-state-docs')).toBeInTheDocument()
    })

    it('shows DiagramViewer for diagram tab even without API key', async () => {
      const user = userEvent.setup()
      render(<PreviewPanel />)

      await user.click(screen.getByText('diagram-tab'))
      expect(await screen.findByText('DiagramViewer')).toBeInTheDocument()
      expect(screen.queryByTestId('ai-empty-state-diagram')).not.toBeInTheDocument()
    })

    it('shows AIFeatureEmptyState for changelog tab when no API key', async () => {
      const user = userEvent.setup()
      render(<PreviewPanel />)

      await user.click(screen.getByText('changelog-tab'))
      expect(screen.getByTestId('ai-empty-state-changelog')).toBeInTheDocument()
    })

    it('shows non-AI tabs normally even without API key', async () => {
      const user = userEvent.setup()
      render(<PreviewPanel />)

      await user.click(screen.getByText('code-tab'))
      // CodeBrowser should render after lazy load (not an empty state)
      expect(await screen.findByText('CodeBrowser')).toBeInTheDocument()
      expect(screen.queryByTestId(/ai-empty-state/)).not.toBeInTheDocument()
    })
  })

  describe('AI tab conditional rendering — has API key', () => {
    beforeEach(() => {
      useConnectedRepository()
      mockGetValidProviders.mockReturnValue(['openai'])
      mockUseAPIKeys.mockReturnValue({
        getValidProviders: mockGetValidProviders,
        isHydrated: true,
      })
    })

    it('shows DocViewer for docs tab when API key is present', async () => {
      const user = userEvent.setup()
      render(<PreviewPanel />)

      await user.click(screen.getByText('docs-tab'))
      expect(await screen.findByText('DocViewer')).toBeInTheDocument()
      expect(screen.queryByTestId('ai-empty-state-docs')).not.toBeInTheDocument()
    })

    it('shows DiagramViewer for diagram tab when API key is present', async () => {
      const user = userEvent.setup()
      render(<PreviewPanel />)

      await user.click(screen.getByText('diagram-tab'))
      expect(await screen.findByText('DiagramViewer')).toBeInTheDocument()
      expect(screen.queryByTestId('ai-empty-state-diagram')).not.toBeInTheDocument()
    })

    it('shows ChangelogViewer for changelog tab when API key is present', async () => {
      const user = userEvent.setup()
      render(<PreviewPanel />)

      await user.click(screen.getByText('changelog-tab'))
      expect(await screen.findByText('ChangelogViewer')).toBeInTheDocument()
      expect(screen.queryByTestId('ai-empty-state-changelog')).not.toBeInTheDocument()
    })
  })
})
