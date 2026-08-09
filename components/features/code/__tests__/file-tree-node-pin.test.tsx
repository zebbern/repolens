import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { FileTreeNode } from '../file-tree-node'
import type { FileNode } from '@/types/repository'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFileNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    name: 'app.ts',
    path: 'src/app.ts',
    type: 'file',
    size: 100,
    ...overrides,
  }
}

function createDirNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    name: 'lib',
    path: 'src/lib',
    type: 'directory',
    size: 0,
    children: [],
    ...overrides,
  }
}

const defaultProps = {
  expandedFolders: new Set<string>(),
  onToggleFolder: vi.fn(),
  onFileSelect: vi.fn(),
  onDownloadFile: vi.fn(),
  onDownloadFolder: vi.fn(),
  activeFilePath: null,
  depth: 0,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileTreeNode — Pin button', () => {
  it('keeps submodules visible but does not select, pin, or download them as files', () => {
    const onFileSelect = vi.fn()
    const onPinToggle = vi.fn()
    const onDownloadFile = vi.fn()
    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[{ name: 'vendor', path: 'vendor', type: 'submodule', gitType: 'commit' }]}
        onFileSelect={onFileSelect}
        onDownloadFile={onDownloadFile}
        isPinned={() => false}
        onPinToggle={onPinToggle}
      />,
    )

    fireEvent.click(screen.getByRole('treeitem', { name: /vendor/i }))
    expect(onFileSelect).not.toHaveBeenCalled()
    expect(onPinToggle).not.toHaveBeenCalled()
    expect(onDownloadFile).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/Pin vendor/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Download vendor/)).not.toBeInTheDocument()
  })

  it('renders pin button when onPinToggle is provided', () => {
    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createFileNode()]}
        isPinned={() => false}
        onPinToggle={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Pin app.ts')).toBeInTheDocument()
  })

  it('does not render pin button when onPinToggle is not provided', () => {
    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createFileNode()]}
      />,
    )

    expect(screen.queryByLabelText(/Pin app\.ts/)).not.toBeInTheDocument()
  })

  it('shows "Unpin" label when file is pinned', () => {
    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createFileNode()]}
        isPinned={() => true}
        onPinToggle={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Unpin app.ts')).toBeInTheDocument()
  })

  it('calls onPinToggle with file path and type on click', () => {
    const onPinToggle = vi.fn()

    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createFileNode({ path: 'src/utils.ts', name: 'utils.ts' })]}
        isPinned={() => false}
        onPinToggle={onPinToggle}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin utils.ts'))

    expect(onPinToggle).toHaveBeenCalledWith('src/utils.ts', 'file')
  })

  it('calls onPinToggle with directory type for directory nodes', () => {
    const onPinToggle = vi.fn()

    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createDirNode({ path: 'src/lib', name: 'lib' })]}
        isPinned={() => false}
        onPinToggle={onPinToggle}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin lib'))

    expect(onPinToggle).toHaveBeenCalledWith('src/lib', 'directory')
  })

  it('pin button click does not trigger file selection (stopPropagation)', () => {
    const onFileSelect = vi.fn()
    const onPinToggle = vi.fn()

    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createFileNode()]}
        onFileSelect={onFileSelect}
        isPinned={() => false}
        onPinToggle={onPinToggle}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin app.ts'))

    expect(onPinToggle).toHaveBeenCalled()
    expect(onFileSelect).not.toHaveBeenCalled()
  })

  it('pin button click does not trigger folder toggle for directories', () => {
    const onToggleFolder = vi.fn()
    const onPinToggle = vi.fn()

    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createDirNode()]}
        onToggleFolder={onToggleFolder}
        isPinned={() => false}
        onPinToggle={onPinToggle}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin lib'))

    expect(onPinToggle).toHaveBeenCalled()
    expect(onToggleFolder).not.toHaveBeenCalled()
  })

  it('pinned file has accent-primary styling (visible even without hover)', () => {
    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createFileNode()]}
        isPinned={() => true}
        onPinToggle={vi.fn()}
      />,
    )

    const pinBtn = screen.getByLabelText('Unpin app.ts')
    expect(pinBtn.className).toContain('text-accent-primary')
    expect(pinBtn.className).toContain('opacity-100')
  })

  it('unpinned file pin button is hidden (opacity-0) by default', () => {
    render(
      <FileTreeNode
        {...defaultProps}
        nodes={[createFileNode()]}
        isPinned={() => false}
        onPinToggle={vi.fn()}
      />,
    )

    const pinBtn = screen.getByLabelText('Pin app.ts')
    expect(pinBtn.className).toContain('opacity-0')
  })
})
