import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const shiki = vi.hoisted(() => {
  interface PendingLanguage {
    language: string
    resolve: () => void
  }

  const pendingLanguages: PendingLanguage[] = []
  const highlighter = {
    loadLanguage: vi.fn((language: string) => new Promise<void>((resolve) => {
      pendingLanguages.push({ language, resolve })
    })),
    codeToTokens: vi.fn((content: string, options: { lang: string; theme: string }) => ({
      tokens: [[{
        content: `${options.lang}:${options.theme}:${content}`,
        color: '#abcdef',
      }]],
    })),
  }

  return {
    pendingLanguages,
    highlighter,
    createHighlighter: vi.fn(async () => highlighter),
  }
})

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}))

vi.mock('shiki', () => ({
  createHighlighter: shiki.createHighlighter,
}))

import { useSyntaxHighlighting } from './use-syntax-highlighting'

function renderedText(lines: ReturnType<typeof useSyntaxHighlighting>): string {
  return lines.flat().map((token) => token.content).join('')
}

async function resolveLanguage(language: string): Promise<void> {
  await waitFor(() => {
    expect(shiki.pendingLanguages.some((pending) => pending.language === language)).toBe(true)
  })

  const index = shiki.pendingLanguages.findIndex((pending) => pending.language === language)
  const [pending] = shiki.pendingLanguages.splice(index, 1)
  await act(async () => {
    pending.resolve()
    await Promise.resolve()
  })
}

describe('useSyntaxHighlighting', () => {
  beforeEach(() => {
    shiki.pendingLanguages.length = 0
    shiki.highlighter.codeToTokens.mockClear()
    shiki.highlighter.loadLanguage.mockClear()
  })

  it('never renders prior tokens across supported, plain, and different supported inputs', async () => {
    const { result, rerender } = renderHook(
      ({ content, language }) => useSyntaxHighlighting(content, language),
      { initialProps: { content: 'const first = true', language: 'first.ts' } },
    )

    await resolveLanguage('typescript')
    await waitFor(() => {
      expect(renderedText(result.current)).toBe('typescript:github-dark:const first = true')
    })

    rerender({ content: 'plain only', language: 'notes.unknown' })
    expect(renderedText(result.current)).toBe('plain only')

    rerender({ content: "print('second')", language: 'second.py' })
    expect(renderedText(result.current)).toBe("print('second')")

    await resolveLanguage('python')
    await waitFor(() => {
      expect(renderedText(result.current)).toBe("python:github-dark:print('second')")
    })
  })

  it('ignores an older async completion after a newer input is highlighted', async () => {
    const { result, rerender } = renderHook(
      ({ content, language }) => useSyntaxHighlighting(content, language),
      { initialProps: { content: 'old()', language: 'old.js' } },
    )

    await waitFor(() => {
      expect(shiki.pendingLanguages.some((pending) => pending.language === 'javascript')).toBe(true)
    })

    rerender({ content: 'package main', language: 'new.go' })
    await resolveLanguage('go')
    await waitFor(() => {
      expect(renderedText(result.current)).toBe('go:github-dark:package main')
    })

    await resolveLanguage('javascript')
    await act(async () => {
      await Promise.resolve()
    })

    expect(renderedText(result.current)).toBe('go:github-dark:package main')
  })
})
