import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
const mockUseAPIKeys = vi.fn(() => ({
  getValidProviders: mockGetValidProviders,
  isHydrated: true,
}))

vi.mock('@/providers', () => ({
  useApp: () => mockUseApp(),
  useRepository: () => mockUseRepository(),
  useRepositoryData: () => {
    const r = mockUseRepository()
    return { repo: r.repo, files: r.files, codeIndex: r.codeIndex, isCacheHit: r.isCacheHit, parsedFiles: [], codebaseAnalysis: null, failedFiles: [] }
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
  flattenFiles: vi.fn(() => []),
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
  LandingPage: (props: any) => (
    <div data-testid="landing-page">
      <button onClick={props.onConnect}>Connect</button>
      <input
        data-testid="repo-url-input"
        value={props.repoUrl}
        onChange={(e: any) => props.onRepoUrlChange(e.target.value)}
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
  GlobalSearchOverlay: () => null,
}))

vi.mock('../preview-repo-header', () => ({
  PreviewRepoHeader: () => <div data-testid="repo-header">header</div>,
}))

vi.mock('../preview-tab-bar', () => ({
  PreviewTabBar: ({ activeTab, onTabChange }: any) => (
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
  GitHistoryPanel: () => <div data-testid="git-history-panel">GitHistoryPanel</div>,
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
    mockUseAPIKeys.mockReturnValue({
      getValidProviders: mockGetValidProviders,
      isHydrated: true,
    })
  })

  it('shows landing page when no repo is connected', () => {
    render(<PreviewPanel />)
    expect(screen.getByTestId('landing-page')).toBeInTheDocument()
  })

  it('accepts a className prop', () => {
    const { container } = render(<PreviewPanel className="custom-class" />)
    expect(container.firstChild).toHaveClass('custom-class')
  })

  describe('AI tab conditional rendering — no API key', () => {
    beforeEach(() => {
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