import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetValidProviders = vi.fn(() => ['openai'])
let mockRepo: any = { fullName: 'owner/repo', owner: 'owner', name: 'repo', description: 'A repo' }
let mockSelectedModel: any = { provider: 'openai', id: 'gpt-4o' }

vi.mock('@/providers', () => ({
  useAPIKeys: () => ({
    selectedModel: mockSelectedModel,
    apiKeys: { openai: { key: 'test' } },
    getValidProviders: mockGetValidProviders,
  }),
  useRepository: () => ({
    repo: mockRepo,
    files: [{ path: 'index.ts' }],
    codeIndex: null,
  }),
  useRepositoryData: () => ({
    repo: mockRepo,
    files: [{ path: 'index.ts' }],
    codeIndex: null,
  }),
  useChangelog: () => ({
    generatedChangelogs: [],
    activeChangelogId: null,
    showNewChangelog: true,
    setActiveChangelogId: vi.fn(),
    setShowNewChangelog: vi.fn(),
    setGeneratedChangelogs: vi.fn(),
    clearChangelogs: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-changelog-engine', () => ({
  useChangelogEngine: () => ({
    generatedChangelogs: [],
    messages: [],
    status: 'ready',
    error: null,
    isGenerating: false,
    stop: vi.fn(),
    handleGenerate: vi.fn(),
    handleRegenerate: vi.fn(),
    handleDeleteChangelog: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}))

vi.mock('@/lib/github/client', () => ({
  fetchTagsViaProxy: vi.fn(() => Promise.resolve([])),
  fetchBranchesViaProxy: vi.fn(() => Promise.resolve([])),
  fetchCompareViaProxy: vi.fn(() => Promise.resolve({ commits: [], files: [], totalCommits: 0 })),
}))

vi.mock('@/lib/export', () => ({
  downloadFile: vi.fn(),
}))

vi.mock('../changelog-helpers', () => ({
  getPresetIcon: vi.fn(() => React.createElement('span', null, '📋')),
  ChangelogMarkdownContent: vi.fn(({ messages }: any) => React.createElement('div', { 'data-testid': 'md-content' }, 'Markdown')),
  QUALITY_STEPS: { fast: 10, balanced: 30, thorough: 50 },
}))

vi.mock('../new-changelog-view', () => ({
  NewChangelogView: vi.fn((props: any) => React.createElement('div', { 'data-testid': 'new-changelog-view' }, 'New Changelog Form')),
}))

import { ChangelogViewer } from '../changelog-viewer'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChangelogViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo = { fullName: 'owner/repo', owner: 'owner', name: 'repo', description: 'A repo' }
    mockSelectedModel = { provider: 'openai', id: 'gpt-4o' }
    mockGetValidProviders.mockReturnValue(['openai'])
  })

  it('shows "No repository connected" when repo is null', () => {
    mockRepo = null
    render(React.createElement(ChangelogViewer))

    expect(screen.getByText('No repository connected')).toBeDefined()
  })

  it('shows "API key required" when no valid providers', () => {
    mockGetValidProviders.mockReturnValue([])
    mockSelectedModel = null
    render(React.createElement(ChangelogViewer))

    expect(screen.getByText('API key required')).toBeDefined()
  })

  it('renders the new changelog form when showNewChangelog is true', () => {
    render(React.createElement(ChangelogViewer))

    expect(screen.getByTestId('new-changelog-view')).toBeDefined()
  })

  it('renders sidebar with "Generated Changelogs" header', () => {
    render(React.createElement(ChangelogViewer))

    expect(screen.getByText('Generated Changelogs')).toBeDefined()
  })

  it('shows empty changelog message in sidebar', () => {
    render(React.createElement(ChangelogViewer))

    expect(screen.getByText(/No changelogs generated yet/)).toBeDefined()
  })

  it('renders "New" button in sidebar', () => {
    render(React.createElement(ChangelogViewer))

    expect(screen.getByTitle('New changelog')).toBeDefined()
  })

  it('passes className prop', () => {
    const { container } = render(React.createElement(ChangelogViewer, { className: 'my-custom-class' }))
    // The outermost div should contain the class
    expect(container.firstElementChild?.className).toContain('my-custom-class')
  })
})
