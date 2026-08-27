import { useRef, useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CodeBrowserFrame } from '../code-browser-frame'
import type { SidebarMode } from '../types'

function MobileFrame() {
  const [mode, setMode] = useState<SidebarMode>('explorer')
  const [open, setOpen] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <CodeBrowserFrame
      ref={containerRef}
      isMobile
      sidebarMode={mode}
      onModeChange={setMode}
      mobileSidebarOpen={open}
      onMobileSidebarOpenChange={setOpen}
      sidebarWidth={240}
      onSidebarWidthChange={vi.fn()}
      sidebarRef={sidebarRef}
      onSidebarMouseDown={vi.fn()}
      sidebar={<div>Sidebar content</div>}
    >
      <div>Editor surface</div>
    </CodeBrowserFrame>
  )
}

function ExternallyOpenedMobileFrame() {
  const [mode, setMode] = useState<SidebarMode>('explorer')
  const [open, setOpen] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  return (
    <CodeBrowserFrame
      isMobile
      sidebarMode={mode}
      onModeChange={setMode}
      mobileSidebarOpen={open}
      onMobileSidebarOpenChange={setOpen}
      sidebarWidth={240}
      onSidebarWidthChange={vi.fn()}
      sidebarRef={sidebarRef}
      onSidebarMouseDown={vi.fn()}
      sidebar={<div>Sidebar content</div>}
    >
      <button onClick={() => setOpen(true)}>Open sidebar externally</button>
    </CodeBrowserFrame>
  )
}

describe('CodeBrowserFrame', () => {
  it('moves the sidebar into a focus-restoring modal drawer on mobile', async () => {
    const user = userEvent.setup()
    render(<MobileFrame />)

    expect(screen.getByText('Editor surface')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Code sidebar' })).not.toBeInTheDocument()

    const searchButton = screen.getByRole('button', { name: 'Open search sidebar' })
    await user.click(searchButton)

    const drawer = screen.getByRole('dialog', { name: 'Search sidebar' })
    expect(within(drawer).getByText('Sidebar content')).toBeVisible()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Search sidebar' })).not.toBeInTheDocument()
    expect(searchButton).toHaveFocus()
  })

  it('keeps a keyboard-resizable sidebar beside the editor on desktop', async () => {
    const user = userEvent.setup()
    const sidebarRef = { current: null }
    const onSidebarWidthChange = vi.fn()
    render(
      <CodeBrowserFrame
        isMobile={false}
        sidebarMode="explorer"
        onModeChange={vi.fn()}
        mobileSidebarOpen={false}
        onMobileSidebarOpenChange={vi.fn()}
        sidebarWidth={240}
        onSidebarWidthChange={onSidebarWidthChange}
        sidebarRef={sidebarRef}
        onSidebarMouseDown={vi.fn()}
        sidebar={<div>Sidebar content</div>}
      >
        <div>Editor surface</div>
      </CodeBrowserFrame>,
    )

    expect(screen.getByRole('complementary', { name: 'Code sidebar' })).toHaveStyle({ width: '240px' })
    const separator = screen.getByRole('separator', { name: 'Resize code sidebar' })
    await user.click(separator)
    await user.keyboard('{ArrowRight}')
    expect(onSidebarWidthChange).toHaveBeenCalledWith(250)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('restores focus when the mobile sidebar is opened outside the activity bar', async () => {
    const user = userEvent.setup()
    render(<ExternallyOpenedMobileFrame />)

    const opener = screen.getByRole('button', { name: 'Open sidebar externally' })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Explorer sidebar' })).toBeVisible()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
