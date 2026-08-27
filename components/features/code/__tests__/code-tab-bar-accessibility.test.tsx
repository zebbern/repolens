import { useRef, useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CodeTabBar } from '../code-tab-bar'
import type { OpenTab } from '../types'

function tab(path: string, isModified = false): OpenTab {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    content: '',
    originalContent: '',
    isLoading: false,
    error: null,
    isModified,
  }
}

describe('CodeTabBar keyboard behavior', () => {
  it('uses tab semantics and moves focus and selection with arrow keys', async () => {
    const user = userEvent.setup()
    const onTabSelect = vi.fn()

    render(
      <CodeTabBar
        openTabs={[tab('src/a.ts'), tab('src/b.ts'), tab('src/c.ts')]}
        activeTabPath="src/a.ts"
        onTabSelect={onTabSelect}
        onTabClose={vi.fn()}
        onRevertFile={vi.fn()}
        onEmptyFocus={vi.fn()}
      />,
    )

    const tabs = screen.getAllByRole('tab')
    expect(screen.getByRole('tablist', { name: 'Open files' })).toBeInTheDocument()
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')

    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()
    expect(onTabSelect).toHaveBeenLastCalledWith('src/b.ts')

    await user.keyboard('{End}')
    expect(tabs[2]).toHaveFocus()
    expect(onTabSelect).toHaveBeenLastCalledWith('src/c.ts')

    await user.keyboard('{Home}')
    expect(tabs[0]).toHaveFocus()
    expect(onTabSelect).toHaveBeenLastCalledWith('src/a.ts')
  })

  it('gives close and revert actions accessible names', () => {
    render(
      <CodeTabBar
        openTabs={[tab('src/a.ts', true)]}
        activeTabPath="src/a.ts"
        onTabSelect={vi.fn()}
        onTabClose={vi.fn()}
        onRevertFile={vi.fn()}
        onEmptyFocus={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Revert changes to a.ts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close a.ts' })).toBeInTheDocument()
    const tablist = screen.getByRole('tablist', { name: 'Open files' })
    expect(within(tablist).getAllByRole('tab')).toHaveLength(1)
    expect(within(tablist).queryByRole('button', { name: 'Close a.ts' })).not.toBeInTheDocument()
  })

  it('restores focus to the adjacent tab after closing the focused tab', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [tabs, setTabs] = useState([tab('src/a.ts'), tab('src/b.ts'), tab('src/c.ts')])
      const [active, setActive] = useState('src/b.ts')
      return (
        <CodeTabBar
          openTabs={tabs}
          activeTabPath={active}
          onTabSelect={setActive}
          onTabClose={(path) => {
            setTabs(current => current.filter(item => item.path !== path))
            setActive('src/c.ts')
          }}
          onRevertFile={vi.fn()}
          onEmptyFocus={vi.fn()}
        />
      )
    }
    render(<Harness />)

    const focused = screen.getByRole('tab', { name: /b\.ts/i })
    focused.focus()
    await user.keyboard('{Delete}')

    expect(screen.queryByRole('tab', { name: /b\.ts/i })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /c\.ts/i })).toHaveFocus()
  })

  it('requests fallback focus after closing the only open tab', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [tabs, setTabs] = useState([tab('src/a.ts')])
      const fallbackRef = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button ref={fallbackRef}>Explorer</button>
          <CodeTabBar
            openTabs={tabs}
            activeTabPath={tabs[0]?.path ?? null}
            onTabSelect={vi.fn()}
            onTabClose={(path) => setTabs(current => current.filter(item => item.path !== path))}
            onRevertFile={vi.fn()}
            onEmptyFocus={() => fallbackRef.current?.focus()}
          />
        </>
      )
    }
    render(<Harness />)

    const focused = screen.getByRole('tab', { name: /a\.ts/i })
    focused.focus()
    await user.keyboard('{Delete}')

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveFocus()
  })
})
