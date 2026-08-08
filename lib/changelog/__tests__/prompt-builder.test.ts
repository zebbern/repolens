import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import { getAssistantText, buildChangelogPrompt } from '../prompt-builder'
import { CHANGELOG_PRESETS } from '../preset-config'
import type { ChangelogPreset } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assistantMsg(text: string, id = 'msg-1'): UIMessage {
  return {
    id,
    role: 'assistant',
    content: text,
    parts: [{ type: 'text', text }],
    createdAt: new Date(),
  } as UIMessage
}

function userMsg(text: string, id = 'user-1'): UIMessage {
  return {
    id,
    role: 'user',
    content: text,
    parts: [{ type: 'text', text }],
    createdAt: new Date(),
  } as UIMessage
}

function assistantMsgNoParts(id = 'no-parts'): UIMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    parts: [],
    createdAt: new Date(),
  } as UIMessage
}

function assistantMsgWithToolCall(id = 'tool-msg'): UIMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    parts: [
      { type: 'tool-invocation', toolCallId: 'tc-1', toolName: 'readFile', state: 'result' } as never,
      { type: 'text', text: 'Analysis result' },
    ],
    createdAt: new Date(),
  } as UIMessage
}

// ---------------------------------------------------------------------------
// getAssistantText
// ---------------------------------------------------------------------------

describe('getAssistantText', () => {
  it('returns empty string for empty messages array', () => {
    expect(getAssistantText([])).toBe('')
  })

  it('extracts text from a single assistant message', () => {
    const result = getAssistantText([assistantMsg('Hello World')])
    expect(result).toBe('Hello World')
  })

  it('concatenates text from multiple assistant messages', () => {
    const msgs = [assistantMsg('Part 1', 'a1'), assistantMsg(' Part 2', 'a2')]
    expect(getAssistantText(msgs)).toBe('Part 1 Part 2')
  })

  it('ignores non-assistant messages', () => {
    const msgs = [userMsg('user question'), assistantMsg('answer')]
    expect(getAssistantText(msgs)).toBe('answer')
  })

  it('handles assistant messages with no text parts', () => {
    const msgs = [assistantMsgNoParts()]
    expect(getAssistantText(msgs)).toBe('')
  })

  it('handles mix of messages with and without text parts', () => {
    const msgs = [assistantMsgNoParts('np'), assistantMsg('Hello', 'a')]
    expect(getAssistantText(msgs)).toBe('Hello')
  })

  it('extracts text alongside tool call parts', () => {
    const msgs = [assistantMsgWithToolCall()]
    expect(getAssistantText(msgs)).toBe('Analysis result')
  })

  it('handles multiple assistant messages with tool calls and text', () => {
    const msgs = [
      assistantMsgWithToolCall('tc1'),
      assistantMsg('Final output', 'final'),
    ]
    expect(getAssistantText(msgs)).toBe('Analysis resultFinal output')
  })
})

// ---------------------------------------------------------------------------
// buildChangelogPrompt
// ---------------------------------------------------------------------------

describe('buildChangelogPrompt', () => {
  const fromRef = 'v1.0.0'
  const toRef = 'v2.0.0'

  it('returns preset prompt with range label for conventional preset', () => {
    const preset = CHANGELOG_PRESETS.find(p => p.id === 'conventional')!
    const result = buildChangelogPrompt(preset, fromRef, toRef, '')

    expect(result).toContain('Changes from `v1.0.0` to `v2.0.0`')
    expect(result).toContain(preset.prompt)
  })

  it('returns preset prompt with range label for release-notes preset', () => {
    const preset = CHANGELOG_PRESETS.find(p => p.id === 'release-notes')!
    const result = buildChangelogPrompt(preset, fromRef, toRef, '')

    expect(result).toContain('Changes from `v1.0.0` to `v2.0.0`')
    expect(result).toContain(preset.prompt)
  })

  it('returns preset prompt with range label for keep-a-changelog preset', () => {
    const preset = CHANGELOG_PRESETS.find(p => p.id === 'keep-a-changelog')!
    const result = buildChangelogPrompt(preset, fromRef, toRef, '')

    expect(result).toContain('Changes from `v1.0.0` to `v2.0.0`')
    expect(result).toContain(preset.prompt)
  })

  it('returns custom prompt with range label for custom preset', () => {
    const preset = CHANGELOG_PRESETS.find(p => p.id === 'custom')!
    const customPrompt = 'List all breaking changes in detail'
    const result = buildChangelogPrompt(preset, fromRef, toRef, customPrompt)

    expect(result).toContain('Changes from `v1.0.0` to `v2.0.0`')
    expect(result).toContain(customPrompt)
  })

  it('returns only range label for custom preset with no custom prompt', () => {
    const preset = CHANGELOG_PRESETS.find(p => p.id === 'custom')!
    const result = buildChangelogPrompt(preset, fromRef, toRef, '')

    expect(result).toBe('Changes from `v1.0.0` to `v2.0.0`')
  })

  it('includes fromRef and toRef in the output for all presets', () => {
    for (const preset of CHANGELOG_PRESETS) {
      const result = buildChangelogPrompt(preset, 'abc123', 'def456', 'custom text')
      expect(result).toContain('abc123')
      expect(result).toContain('def456')
    }
  })

  it('does not include the preset prompt for custom type', () => {
    const preset = CHANGELOG_PRESETS.find(p => p.id === 'custom')!
    const result = buildChangelogPrompt(preset, fromRef, toRef, 'My instructions')

    // Custom preset has empty prompt, so it should not appear
    expect(result).not.toContain('Conventional Commits')
    expect(result).not.toContain('keepachangelog')
    expect(result).toContain('My instructions')
  })

  it('handles special characters in refs', () => {
    const preset = CHANGELOG_PRESETS.find(p => p.id === 'conventional')!
    const result = buildChangelogPrompt(preset, 'feature/my-branch', 'release/2.0', '')

    expect(result).toContain('feature/my-branch')
    expect(result).toContain('release/2.0')
  })
})
