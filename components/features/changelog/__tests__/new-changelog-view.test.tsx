import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('@/components/features/chat/skill-selector', () => ({
  SkillSelector: () => null,
}))

import { NewChangelogView } from '../new-changelog-view'

type NewChangelogViewProps = React.ComponentProps<typeof NewChangelogView>

const tag = (name: string) => ({ name, commitSha: name, commitUrl: '', tarballUrl: '', zipballUrl: '' })

function renderView(overrides: Partial<NewChangelogViewProps> = {}) {
  const tags = [tag('v2'), tag('v1')]
  const props: NewChangelogViewProps = {
    contentRef: { current: null },
    isMobile: false,
    sidebarOpen: false,
    setSidebarOpen: vi.fn(),
    sidebarContent: null,
    isGenerating: false,
    isFetchingCommits: false,
    messages: [],
    stop: vi.fn(),
    selectedModel: null,
    refSource: 'tags',
    setRefSource: vi.fn(),
    tags,
    branches: [],
    refsLoading: false,
    refsError: null,
    refOptions: tags.map(t => ({ label: t.name, value: t.name })),
    refsTruncated: false,
    fromRef: 'v1',
    setFromRef: vi.fn(),
    toRef: 'v2',
    setToRef: vi.fn(),
    qualityLevel: 'balanced',
    setQualityLevel: vi.fn(),
    activeSkills: new Set(),
    onSkillToggle: vi.fn(),
    commitFetchError: null,
    error: null,
    selectedPreset: null,
    setSelectedPreset: vi.fn(),
    customPrompt: '',
    setCustomPrompt: vi.fn(),
    onGenerate: vi.fn(),
    ...overrides,
  }
  return render(React.createElement(NewChangelogView, props))
}

describe('NewChangelogView ref range', () => {
  it('tells the user when the listed refs were cut off at the pagination cap', () => {
    renderView({ refsTruncated: true })

    expect(screen.getByText('Showing the first 2 tags. This repository has more that are not listed.')).toBeDefined()
  })

  it('shows no truncation notice for a complete list', () => {
    renderView({ refsTruncated: false })

    expect(screen.queryByText(/not listed/)).toBeNull()
  })
})
