import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewTabBar } from '../preview-tab-bar'
import type { PreviewTab } from '../tab-config'

// Stub lucide icons as simple SVG elements
const StubIcon = (props: any) => <svg data-testid="stub-icon" {...props} />

const AI_TAB: PreviewTab = { id: 'docs', label: 'Docs', icon: StubIcon as any, requiresAI: true }
const NON_AI_TAB: PreviewTab = { id: 'issues', label: 'Issues', icon: StubIcon as any }

const TABS: PreviewTab[] = [
  { id: 'repo', label: 'Repo', icon: StubIcon as any },
  NON_AI_TAB,
  AI_TAB,
  { id: 'diagram', label: 'Diagram', icon: StubIcon as any },
  { id: 'code', label: 'Code', icon: StubIcon as any },
  { id: 'changelog', label: 'Changelog', icon: StubIcon as any, requiresAI: true },
]

const DEFAULT_PROPS = {
  tabs: TABS,
  activeTab: 'repo',
  onTabChange: vi.fn(),
  hasRepo: false,
  fileCount: 0,
  onOpenSearch: vi.fn(),
  localPreviewUrl: null,
  hasApiKey: true,
}

describe('PreviewTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Stub navigator.platform for the isMac detection
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
  })

  describe('when hasApiKey is false', () => {
    it('applies opacity-50 to AI tabs', () => {
      render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={false} />)

      const docsButton = screen.getByRole('tab', { name: /docs/i })
      expect(docsButton).toHaveClass('opacity-50')

      const changelogButton = screen.getByRole('tab', { name: /changelog/i })
      expect(changelogButton).toHaveClass('opacity-50')
    })

    it('shows Lock icon on AI tabs', () => {
      const { container } = render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={false} />)

      // AI tabs should have lock icons — there are 2 AI tabs
      const lockIcons = container.querySelectorAll('.lucide-lock')
      expect(lockIcons.length).toBe(2)
    })

    it('sets locked title on AI tabs', () => {
      render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={false} />)

      const docsButton = screen.getByRole('tab', { name: /docs/i })
      expect(docsButton).toHaveAttribute('title', 'Requires API key — set up in Settings')

      const changelogButton = screen.getByRole('tab', { name: /changelog/i })
      expect(changelogButton).toHaveAttribute('title', 'Requires API key — set up in Settings')
    })

    it('does NOT apply opacity-50 to non-AI tabs', () => {
      render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={false} />)

      const repoButton = screen.getByRole('tab', { name: /repo/i })
      expect(repoButton).not.toHaveClass('opacity-50')

      const issuesButton = screen.getByRole('tab', { name: /issues/i })
      expect(issuesButton).not.toHaveClass('opacity-50')

      const diagramButton = screen.getByRole('tab', { name: /diagram/i })
      expect(diagramButton).not.toHaveClass('opacity-50')

      const codeButton = screen.getByRole('tab', { name: /code/i })
      expect(codeButton).not.toHaveClass('opacity-50')
    })

    it('sets normal title on non-AI tabs', () => {
      render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={false} />)

      const repoButton = screen.getByRole('tab', { name: /repo/i })
      expect(repoButton).toHaveAttribute('title', 'Repo')

      const issuesButton = screen.getByRole('tab', { name: /issues/i })
      expect(issuesButton).toHaveAttribute('title', 'Issues')
    })
  })

  describe('when hasApiKey is true', () => {
    it('does NOT apply opacity-50 to AI tabs', () => {
      render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={true} />)

      const docsButton = screen.getByRole('tab', { name: /docs/i })
      expect(docsButton).not.toHaveClass('opacity-50')

      const changelogButton = screen.getByRole('tab', { name: /changelog/i })
      expect(changelogButton).not.toHaveClass('opacity-50')
    })

    it('does NOT show Lock icon on AI tabs', () => {
      const { container } = render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={true} />)

      const lockIcons = container.querySelectorAll('.lucide-lock')
      expect(lockIcons.length).toBe(0)
    })

    it('sets normal title on AI tabs', () => {
      render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={true} />)

      const docsButton = screen.getByRole('tab', { name: /docs/i })
      expect(docsButton).toHaveAttribute('title', 'Docs')
    })
  })

  describe('non-AI tabs', () => {
    it('always render normally regardless of hasApiKey', () => {
      const { rerender } = render(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={false} />)

      const repoButton = screen.getByRole('tab', { name: /repo/i })
      expect(repoButton).not.toHaveClass('opacity-50')
      expect(repoButton).toHaveAttribute('title', 'Repo')

      rerender(<PreviewTabBar {...DEFAULT_PROPS} hasApiKey={true} />)

      const repoButton2 = screen.getByRole('tab', { name: /repo/i })
      expect(repoButton2).not.toHaveClass('opacity-50')
      expect(repoButton2).toHaveAttribute('title', 'Repo')
    })
  })

  it('calls onTabChange when a tab is clicked', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(<PreviewTabBar {...DEFAULT_PROPS} onTabChange={onTabChange} />)

    await user.click(screen.getByRole('tab', { name: /issues/i }))
    expect(onTabChange).toHaveBeenCalledWith('issues')
  })
})
