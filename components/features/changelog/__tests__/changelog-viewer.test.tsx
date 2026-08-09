import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetValidProviders = vi.fn(() => ['openai'])
let mockRepo: { fullName: string; owner: string; name: string; description: string } | null = { fullName: 'owner/repo', owner: 'owner', name: 'repo', description: 'A repo' }
let mockSelectedModel: { provider: string; id: string } | null = { provider: 'openai', id: 'gpt-4o' }

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
  ChangelogMarkdownContent: vi.fn(() => React.createElement('div', { 'data-testid': 'md-content' }, 'Markdown')),
  QUALITY_STEPS: { fast: 10, balanced: 30, thorough: 50 },
}))

vi.mock('../new-changelog-view', () => ({
  NewChangelogView: vi.fn((props: {
    customPrompt: string
    setCustomPrompt: (value: string) => void
    activeSkills: Set<string>
    onSkillToggle: (id: string) => void
  }) => React.createElement(
    'div',
    { 'data-testid': 'new-changelog-view' },
    React.createElement('span', null, 'New Changelog Form'),
    React.createElement('input', {
      'aria-label': 'changelog draft',
      value: props.customPrompt,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.setCustomPrompt(event.target.value),
    }),
    React.createElement('span', null, `skills:${props.activeSkills.size}`),
    React.createElement('button', {
      type: 'button',
      onClick: () => props.onSkillToggle('release-notes'),
    }, 'toggle skill'),
  )),
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

  it('clears repository-derived draft state while preserving selected skills', async () => {
    const { rerender } = render(React.createElement(ChangelogViewer))

    fireEvent.change(screen.getByLabelText('changelog draft'), { target: { value: 'Repository A changes' } })
    fireEvent.click(screen.getByRole('button', { name: 'toggle skill' }))
    expect(screen.getByLabelText('changelog draft')).toHaveValue('Repository A changes')
    expect(screen.getByText('skills:1')).toBeDefined()

    mockRepo = { fullName: 'owner/repo-b', owner: 'owner', name: 'repo-b', description: 'Repository B' }
    await act(async () => {
      rerender(React.createElement(ChangelogViewer))
      await Promise.resolve()
    })

    expect(screen.getByLabelText('changelog draft')).toHaveValue('')
    expect(screen.getByText('skills:1')).toBeDefined()
  })
})
