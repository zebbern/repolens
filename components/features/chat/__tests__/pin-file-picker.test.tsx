import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { PinFilePicker } from '../pin-file-picker'
import type { PinnedFile } from '@/types/types'
import { createEmptyIndex, type CodeIndex } from '@/lib/code/code-index'
import { PINNED_CONTEXT_CONFIG } from '@/config/constants'

// cmdk uses ResizeObserver and Element.scrollIntoView — polyfill for jsdom
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal CodeIndex with the given file paths. */
function buildMockCodeIndex(
  files: Array<{ path: string; content?: string; lineCount?: number }>,
): CodeIndex {
  const map = new Map<string, { path: string; name: string; content: string; language: string; lines: string[]; lineCount: number }>()
  for (const f of files) {
    const content = f.content ?? `// ${f.path}`
    const lines = content.split('\n')
    map.set(f.path, {
      path: f.path,
      name: f.path.split('/').pop() ?? f.path,
      content,
      language: 'typescript',
      lines,
      lineCount: f.lineCount ?? lines.length,
    })
  }
  return {
    ...createEmptyIndex(),
    files: map,
    totalFiles: map.size,
    totalLines: Array.from(map.values()).reduce((s, f) => s + f.lineCount, 0),
  }
}

function createPinnedFiles(paths: string[]): Map<string, PinnedFile> {
  const map = new Map<string, PinnedFile>()
  for (const path of paths) {
    map.set(path, { path, type: 'file' })
  }
  return map
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PinFilePicker', () => {
  it('renders the trigger button with correct aria-label', () => {
    render(
      <PinFilePicker
        codeIndex={buildMockCodeIndex([])}
        pinnedFiles={new Map()}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
      />,
    )

    const trigger = screen.getByLabelText('Pin files to chat context')
    expect(trigger).toBeInTheDocument()
  })

  it('shows pin count badge when files are pinned', () => {
    const pinnedFiles = createPinnedFiles(['src/a.ts', 'src/b.ts'])

    render(
      <PinFilePicker
        codeIndex={buildMockCodeIndex([
          { path: 'src/a.ts' },
          { path: 'src/b.ts' },
        ])}
        pinnedFiles={pinnedFiles}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
      />,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('opens popover on click and shows file list', async () => {
    const codeIndex = buildMockCodeIndex([
      { path: 'src/utils.ts', lineCount: 42 },
      { path: 'src/helpers.ts', lineCount: 100 },
    ])

    render(
      <PinFilePicker
        codeIndex={codeIndex}
        pinnedFiles={new Map()}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
      />,
    )

    const trigger = screen.getByLabelText('Pin files to chat context')
    fireEvent.click(trigger)

    // File paths should appear in the popover
    expect(await screen.findByText('src/utils.ts')).toBeInTheDocument()
    expect(screen.getByText('src/helpers.ts')).toBeInTheDocument()
  })

  it('clicking an unpinned file calls onPin', async () => {
    const onPin = vi.fn()
    const codeIndex = buildMockCodeIndex([{ path: 'src/target.ts' }])

    render(
      <PinFilePicker
        codeIndex={codeIndex}
        pinnedFiles={new Map()}
        onPin={onPin}
        onUnpin={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin files to chat context'))
    const item = await screen.findByText('src/target.ts')
    fireEvent.click(item)

    expect(onPin).toHaveBeenCalledWith('src/target.ts', 'file')
  })

  it('clicking a pinned file calls onUnpin', async () => {
    const onUnpin = vi.fn()
    const codeIndex = buildMockCodeIndex([{ path: 'src/pinned.ts' }])
    const pinnedFiles = createPinnedFiles(['src/pinned.ts'])

    render(
      <PinFilePicker
        codeIndex={codeIndex}
        pinnedFiles={pinnedFiles}
        onPin={vi.fn()}
        onUnpin={onUnpin}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin files to chat context'))
    const item = await screen.findByText('src/pinned.ts')
    fireEvent.click(item)

    expect(onUnpin).toHaveBeenCalledWith('src/pinned.ts')
  })

  it('shows footer with pin count', async () => {
    const pinnedFiles = createPinnedFiles(['src/a.ts'])
    const codeIndex = buildMockCodeIndex([{ path: 'src/a.ts' }, { path: 'src/b.ts' }])

    render(
      <PinFilePicker
        codeIndex={codeIndex}
        pinnedFiles={pinnedFiles}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin files to chat context'))

    expect(
      await screen.findByText(`1/${PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES} files pinned`),
    ).toBeInTheDocument()
  })

  it('shows "Limit reached" when at MAX_PINNED_FILES', async () => {
    // Build enough files and pin them all
    const paths = Array.from(
      { length: PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES },
      (_, i) => `file-${i}.ts`,
    )
    const pinnedFiles = createPinnedFiles(paths)
    const codeIndex = buildMockCodeIndex(
      [...paths, 'extra.ts'].map((p) => ({ path: p })),
    )

    render(
      <PinFilePicker
        codeIndex={codeIndex}
        pinnedFiles={pinnedFiles}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin files to chat context'))

    expect(await screen.findByText('Limit reached')).toBeInTheDocument()
  })

  it('disables unpinned items when at limit', async () => {
    const paths = Array.from(
      { length: PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES },
      (_, i) => `file-${i}.ts`,
    )
    const pinnedFiles = createPinnedFiles(paths)
    const codeIndex = buildMockCodeIndex(
      [...paths, 'extra-unpinned.ts'].map((p) => ({ path: p })),
    )

    render(
      <PinFilePicker
        codeIndex={codeIndex}
        pinnedFiles={pinnedFiles}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin files to chat context'))

    // Wait for List to render
    await screen.findByText(`${PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES}/${PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES} files pinned`)

    // The extra-unpinned item should be aria-disabled
    const extraItem = screen.getByText('extra-unpinned.ts').closest('[cmdk-item]')
    expect(extraItem).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not call onPin for disabled items when at limit', async () => {
    const onPin = vi.fn()
    const paths = Array.from(
      { length: PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES },
      (_, i) => `file-${i}.ts`,
    )
    const pinnedFiles = createPinnedFiles(paths)
    const codeIndex = buildMockCodeIndex(
      [...paths, 'cant-pin.ts'].map((p) => ({ path: p })),
    )

    render(
      <PinFilePicker
        codeIndex={codeIndex}
        pinnedFiles={pinnedFiles}
        onPin={onPin}
        onUnpin={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Pin files to chat context'))
    await screen.findByText('Limit reached')

    // Click the disabled item — cmdk shouldn't fire onSelect for disabled items,
    // but even if it does, our handleSelect guards against it
    const item = screen.getByText('cant-pin.ts')
    fireEvent.click(item)

    expect(onPin).not.toHaveBeenCalled()
  })
})
