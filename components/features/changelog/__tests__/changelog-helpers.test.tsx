import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

interface MockPart {
  type: string
  text?: string
  toolName?: string
}

interface MockMessage {
  role: string
  parts?: MockPart[]
}

// Mock AI module
vi.mock('ai', () => ({
  isToolUIPart: (part: MockPart) => part.type === 'tool-invocation',
  getToolName: (part: MockPart) => part.toolName || 'unknown',
}))

vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) =>
    React.createElement('div', { 'data-testid': 'markdown-renderer' }, content),
}))

vi.mock('@/providers/changelog-provider', () => ({
  getAssistantText: (msgs: MockMessage[]) => {
    return msgs
      .filter(m => m.role === 'assistant')
      .flatMap(m => (m.parts || []).filter(p => p.type === 'text').map(p => p.text))
      .join('')
  },
}))

import {
  getPresetIcon,
  ChangelogMarkdownContent,
  ChangelogToolActivity,
  QUALITY_STEPS,
} from '../changelog-helpers'

// ---------------------------------------------------------------------------
// getPresetIcon
// ---------------------------------------------------------------------------

describe('getPresetIcon', () => {
  it('returns a React element for "conventional"', () => {
    const icon = getPresetIcon('conventional')
    expect(icon).toBeDefined()
  })

  it('returns a React element for "release-notes"', () => {
    const icon = getPresetIcon('release-notes')
    expect(icon).toBeDefined()
  })

  it('returns a React element for "keep-a-changelog"', () => {
    const icon = getPresetIcon('keep-a-changelog')
    expect(icon).toBeDefined()
  })

  it('returns a React element for "custom"', () => {
    const icon = getPresetIcon('custom')
    expect(icon).toBeDefined()
  })

  it('returns fallback icon for unknown type', () => {
    const icon = getPresetIcon('nonexistent' as never)
    expect(icon).toBeDefined()
  })

  it('each type returns a different icon', () => {
    const conventional = getPresetIcon('conventional')
    const releaseNotes = getPresetIcon('release-notes')
    const keepAChangelog = getPresetIcon('keep-a-changelog')
    const custom = getPresetIcon('custom')

    // They should all be valid React elements
    expect(React.isValidElement(conventional)).toBe(true)
    expect(React.isValidElement(releaseNotes)).toBe(true)
    expect(React.isValidElement(keepAChangelog)).toBe(true)
    expect(React.isValidElement(custom)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// QUALITY_STEPS
// ---------------------------------------------------------------------------

describe('QUALITY_STEPS', () => {
  it('has fast, balanced, and thorough levels', () => {
    expect(QUALITY_STEPS).toHaveProperty('fast')
    expect(QUALITY_STEPS).toHaveProperty('balanced')
    expect(QUALITY_STEPS).toHaveProperty('thorough')
  })

  it('fast < balanced < thorough', () => {
    expect(QUALITY_STEPS.fast).toBeLessThan(QUALITY_STEPS.balanced)
    expect(QUALITY_STEPS.balanced).toBeLessThan(QUALITY_STEPS.thorough)
  })

  it('all step values are positive numbers', () => {
    for (const val of Object.values(QUALITY_STEPS)) {
      expect(val).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// ChangelogMarkdownContent
// ---------------------------------------------------------------------------

describe('ChangelogMarkdownContent', () => {
  it('renders markdown when assistant text exists', () => {
    const messages = [
      { role: 'assistant', parts: [{ type: 'text', text: '# Changelog\n- Feature A' }] },
    ]
    render(React.createElement(ChangelogMarkdownContent, { messages: messages as never }))
    expect(screen.getByTestId('markdown-renderer')).toBeDefined()
    expect(screen.getByTestId('markdown-renderer').textContent).toContain('# Changelog')
  })

  it('renders nothing when no assistant text', () => {
    const messages = [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
    const { container } = render(React.createElement(ChangelogMarkdownContent, { messages: messages as never }))
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for empty messages', () => {
    const { container } = render(React.createElement(ChangelogMarkdownContent, { messages: [] }))
    expect(container.innerHTML).toBe('')
  })
})

// ---------------------------------------------------------------------------
// ChangelogToolActivity
// ---------------------------------------------------------------------------

describe('ChangelogToolActivity', () => {
  it('shows "Starting changelog generation..." with no tool calls or text', () => {
    const messages = [{ role: 'assistant', parts: [] }]
    render(React.createElement(ChangelogToolActivity, { messages: messages as never }))
    expect(screen.getByText('Starting changelog generation...')).toBeDefined()
  })

  it('shows "Reading codebase..." when tool calls are pending', () => {
    const messages = [{
      role: 'assistant',
      parts: [{
        type: 'tool-invocation',
        toolCallId: 'tc1',
        toolName: 'readFile',
        input: { path: 'src/index.ts' },
        state: 'call',
      }],
    }]
    render(React.createElement(ChangelogToolActivity, { messages: messages as never }))
    expect(screen.getByText('Reading codebase...')).toBeDefined()
  })

  it('shows "Read N files" badge for completed reads', () => {
    const messages = [{
      role: 'assistant',
      parts: [
        { type: 'tool-invocation', toolCallId: 'tc1', toolName: 'readFile', input: { path: 'a.ts' }, state: 'output-available' },
        { type: 'tool-invocation', toolCallId: 'tc2', toolName: 'readFile', input: { path: 'b.ts' }, state: 'output-available' },
        { type: 'text', text: 'Changelog output' },
      ],
    }]
    render(React.createElement(ChangelogToolActivity, { messages: messages as never }))
    expect(screen.getByText('Read 2 files')).toBeDefined()
  })

  it('shows search count badge', () => {
    const messages = [{
      role: 'assistant',
      parts: [
        { type: 'tool-invocation', toolCallId: 'tc1', toolName: 'searchFiles', input: { query: 'auth' }, state: 'output-available' },
        { type: 'text', text: 'done' },
      ],
    }]
    render(React.createElement(ChangelogToolActivity, { messages: messages as never }))
    expect(screen.getByText('1 searches')).toBeDefined()
  })
})
