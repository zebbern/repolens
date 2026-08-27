import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FileTreeNode } from '../file-tree-node'
import type { FileNode } from '@/types/repository'

const nodes: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      { name: 'a.ts', path: 'src/a.ts', type: 'file', size: 10 },
    ],
  },
  { name: 'README.md', path: 'README.md', type: 'file', size: 10 },
]

const defaultProps = {
  nodes,
  expandedFolders: new Set(['src']),
  onToggleFolder: vi.fn(),
  onFileSelect: vi.fn(),
  onDownloadFile: vi.fn(),
  onDownloadFolder: vi.fn(),
  activeFilePath: null,
  depth: 0,
  isPinned: () => false,
  onPinToggle: vi.fn(),
}

describe('FileTreeNode keyboard navigation', () => {
  it('exposes one roving tab stop and supports Arrow, Home, and End navigation', async () => {
    const user = userEvent.setup()
    render(<FileTreeNode {...defaultProps} />)

    const tree = screen.getByRole('tree', { name: 'Repository files' })
    const items = screen.getAllByRole('treeitem')
    expect(tree).toBeInTheDocument()
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])

    items[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1])

    await user.keyboard('{End}')
    expect(items[2]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(items[0]).toHaveFocus()
  })

  it('uses ArrowLeft and ArrowRight to collapse and expand directories', async () => {
    const user = userEvent.setup()
    const onToggleFolder = vi.fn()
    const { rerender } = render(
      <FileTreeNode {...defaultProps} expandedFolders={new Set()} onToggleFolder={onToggleFolder} />,
    )

    const directory = screen.getByRole('treeitem', { name: /src/i })
    directory.focus()
    await user.keyboard('{ArrowRight}')
    expect(onToggleFolder).toHaveBeenCalledWith('src')

    rerender(
      <FileTreeNode {...defaultProps} expandedFolders={new Set(['src'])} onToggleFolder={onToggleFolder} />,
    )
    screen.getByRole('treeitem', { name: /src/i }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(onToggleFolder).toHaveBeenLastCalledWith('src')
  })

  it('keeps focus at the first and last items instead of wrapping', async () => {
    const user = userEvent.setup()
    render(<FileTreeNode {...defaultProps} />)
    const items = screen.getAllByRole('treeitem')

    items[0].focus()
    await user.keyboard('{ArrowUp}')
    expect(items[0]).toHaveFocus()

    items.at(-1)!.focus()
    await user.keyboard('{ArrowDown}')
    expect(items.at(-1)).toHaveFocus()
  })

  it('keeps one composite tab stop and exposes keyboard action shortcuts', async () => {
    const user = userEvent.setup()
    const onPinToggle = vi.fn()
    const onDownloadFolder = vi.fn()
    render(
      <>
        <FileTreeNode
          {...defaultProps}
          onPinToggle={onPinToggle}
          onDownloadFolder={onDownloadFolder}
        />
        <button>After tree</button>
      </>,
    )

    const items = screen.getAllByRole('treeitem')
    const pinSrc = screen.getByRole('button', { name: 'Pin src' })
    const pinChild = screen.getByRole('button', { name: 'Pin a.ts' })
    expect(pinSrc).toHaveAttribute('tabindex', '-1')
    expect(pinChild).toHaveAttribute('tabindex', '-1')

    items[0].focus()
    await user.keyboard('p')
    expect(onPinToggle).toHaveBeenCalledWith('src', 'directory')
    await user.keyboard('d')
    expect(onDownloadFolder).toHaveBeenCalledWith(nodes[0])

    await user.tab()
    expect(screen.getByRole('button', { name: 'After tree' })).toHaveFocus()
  })

  it('does not intercept browser or operating-system shortcuts that include modifiers', () => {
    const onPinToggle = vi.fn()
    const onDownloadFolder = vi.fn()
    render(
      <FileTreeNode
        {...defaultProps}
        onPinToggle={onPinToggle}
        onDownloadFolder={onDownloadFolder}
      />,
    )

    const directory = screen.getByRole('treeitem', { name: /src/i })
    directory.focus()
    fireEvent.keyDown(directory, { key: 'p', ctrlKey: true })
    fireEvent.keyDown(directory, { key: 'P', metaKey: true })
    fireEvent.keyDown(directory, { key: 'd', altKey: true })

    expect(onPinToggle).not.toHaveBeenCalled()
    expect(onDownloadFolder).not.toHaveBeenCalled()
  })
})
