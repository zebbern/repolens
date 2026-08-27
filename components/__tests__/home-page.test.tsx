import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}))

vi.mock('@/providers', () => ({
  useApp: () => ({
    isChatCollapsed: false,
    chatFocusRequest: 0,
    setChatCollapsed: vi.fn(),
  }),
}))

vi.mock('@/components/layout/header', () => ({
  Header: () => <header>RepoLens</header>,
}))

vi.mock('@/components/layout/resizable-layout', () => ({
  ResizableLayout: () => null,
}))

vi.mock('@/components/features/preview/preview-panel', () => ({
  PreviewPanel: () => <main>Repository preview</main>,
}))

vi.mock('@/components/features/chat/chat-sidebar', () => ({
  ChatSidebar: () => <div>Chat sidebar</div>,
}))

import HomePage from '@/app/page'

describe('HomePage mobile chat sheet', () => {
  it('describes the dialog and restores focus to its opener on Escape', async () => {
    const user = userEvent.setup()
    render(<HomePage />)

    const opener = screen.getByRole('button', { name: 'Open chat' })
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Chat' })
    expect(dialog).toHaveAccessibleDescription(
      'Chat with RepoLens about repository code and analysis.',
    )

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chat' })).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })
})
