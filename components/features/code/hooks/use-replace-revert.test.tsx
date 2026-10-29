import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { batchIndexFiles, createEmptyIndex, type CodeIndex, type SearchResult } from '@/lib/code/code-index'
import type { OpenTab } from '../types'
import { useReplace } from './use-replace'

const session = { id: 1, signal: new AbortController().signal }

function openTab(path: string, content: string): OpenTab {
  return {
    path,
    name: path,
    language: 'typescript',
    content,
    originalContent: content,
    isLoading: false,
    error: null,
    isModified: false,
  }
}

function match(file: string, line: number): SearchResult {
  return { file, matches: [{ line, content: '', column: 0, length: 3 }] }
}

function indexOf(files: Record<string, string>): CodeIndex {
  return batchIndexFiles(createEmptyIndex(), Object.entries(files).map(([path, content]) => ({ path, content, language: 'typescript' })))
}

interface HarnessOptions {
  index: CodeIndex
  tabs?: OpenTab[]
  searchResults?: SearchResult[]
  /** Reads of this path wait for `releaseSlowRead()`, like an IndexedDB or network read. */
  slowPath?: string
}

interface HarnessProps {
  query: string
  replacement: string
}

let releaseSlowRead: () => void = () => {}

/** Wires useReplace to real state the way the repository provider and code browser do. */
function useReplaceHarness({ index, tabs = [], searchResults = [], slowPath }: HarnessOptions, { query, replacement }: HarnessProps) {
  const [codeIndex, setCodeIndex] = useState(index)
  const [modifiedContents, setModifiedContents] = useState(() => new Map<string, string>())
  const [originalContents, setOriginalContents] = useState(() => new Map<string, string>())
  const [openTabs, setOpenTabs] = useState(tabs)
  const getFileContent = async (path: string) => {
    const content = modifiedContents.get(path) ?? codeIndex.files.get(path)?.content ?? await codeIndex.contentStore.get(path)
    if (path === slowPath) await new Promise<void>(resolve => { releaseSlowRead = resolve })
    return content
  }
  const replace = useReplace({
    updateCodeIndex: setCodeIndex,
    setModifiedContents,
    originalContents,
    setOriginalContents,
    getFileContent,
    debouncedSearchQuery: query,
    searchOptions: { caseSensitive: true, wholeWord: false, regex: false },
    replaceQuery: replacement,
    searchResults,
    setOpenTabs,
    repositorySession: session,
    isRepositorySessionCurrent: candidate => candidate === session,
  })
  return { ...replace, codeIndex, modifiedContents, originalContents, openTabs, setOpenTabs }
}

function renderHarness(options: HarnessOptions) {
  return renderHook(
    (props: HarnessProps) => useReplaceHarness(options, props),
    { initialProps: { query: 'old', replacement: 'new' } },
  )
}

describe('useReplace revert', () => {
  it('restores the pre-edit source after replacing all matches in a file', async () => {
    const { result } = renderHarness({ index: indexOf({ 'a.ts': 'const old = 1' }), tabs: [openTab('a.ts', 'const old = 1')] })

    await act(async () => result.current.replaceAllInFile('a.ts'))
    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('const new = 1')

    await act(async () => result.current.revertFile('a.ts'))

    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('const old = 1')
    expect(await result.current.codeIndex.contentStore.get('a.ts')).toBe('const old = 1')
    expect(result.current.modifiedContents.has('a.ts')).toBe(false)
    expect(result.current.originalContents.has('a.ts')).toBe(false)
    expect(result.current.openTabs[0]).toMatchObject({
      content: 'const old = 1',
      originalContent: 'const old = 1',
      isModified: false,
    })
  })

  it('restores the source from before the first of several edits', async () => {
    const { result } = renderHarness({ index: indexOf({ 'a.ts': 'old()\nold()' }), tabs: [openTab('a.ts', 'old()\nold()')] })

    await act(async () => result.current.replaceInFile('a.ts', 1))
    await act(async () => result.current.replaceInFile('a.ts', 2))
    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('new()\nnew()')

    await act(async () => result.current.revertFile('a.ts'))

    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('old()\nold()')
    expect(result.current.openTabs[0].content).toBe('old()\nold()')
  })

  it('keeps the first baseline when a replace-all hits an already edited file', async () => {
    const { result } = renderHarness({
      index: indexOf({ 'a.ts': 'old()\nold()' }),
      tabs: [openTab('a.ts', 'old()\nold()')],
      searchResults: [match('a.ts', 2)],
    })

    await act(async () => result.current.replaceInFile('a.ts', 1))
    await act(async () => result.current.replaceAllInAllFiles())
    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('new()\nnew()')
    expect(result.current.originalContents.get('a.ts')).toBe('old()\nold()')

    await act(async () => result.current.revertFile('a.ts'))

    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('old()\nold()')
    expect(result.current.openTabs[0].content).toBe('old()\nold()')
  })

  it('reverts one file of a replace-all across files and leaves the other edited', async () => {
    const { result } = renderHarness({
      index: indexOf({ 'a.ts': 'old a', 'b.ts': 'old b' }),
      tabs: [openTab('a.ts', 'old a'), openTab('b.ts', 'old b')],
      searchResults: [match('a.ts', 1), match('b.ts', 1)],
    })

    await act(async () => result.current.replaceAllInAllFiles())
    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('new a')

    await act(async () => result.current.revertFile('a.ts'))

    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('old a')
    expect(result.current.codeIndex.files.get('b.ts')?.content).toBe('new b')
    expect(result.current.modifiedContents).toEqual(new Map([['b.ts', 'new b']]))
    expect(result.current.originalContents).toEqual(new Map([['b.ts', 'old b']]))
    expect(result.current.openTabs.map(tab => [tab.path, tab.content, tab.isModified])).toEqual([
      ['a.ts', 'old a', false],
      ['b.ts', 'new b', true],
    ])
  })

  it('keeps earlier edits to other files when another file is edited', async () => {
    const { result } = renderHarness({ index: indexOf({ 'a.ts': 'old a', 'b.ts': 'old b' }) })

    await act(async () => result.current.replaceAllInFile('a.ts'))
    await act(async () => result.current.replaceAllInFile('b.ts'))

    expect(result.current.modifiedContents).toEqual(new Map([['a.ts', 'new a'], ['b.ts', 'new b']]))
    expect(result.current.originalContents).toEqual(new Map([['a.ts', 'old a'], ['b.ts', 'old b']]))
    expect(result.current.codeIndex.files.get('a.ts')?.content).toBe('new a')
  })

  it('marks a tab unmodified once a later edit restores the pre-edit source', async () => {
    const { result, rerender } = renderHarness({ index: indexOf({ 'a.ts': 'const old = 1' }), tabs: [openTab('a.ts', 'const old = 1')] })

    await act(async () => result.current.replaceAllInFile('a.ts'))
    expect(result.current.openTabs[0].isModified).toBe(true)

    rerender({ query: 'new', replacement: 'old' })
    await act(async () => result.current.replaceAllInFile('a.ts'))

    expect(result.current.openTabs[0]).toMatchObject({ content: 'const old = 1', isModified: false })
    expect(result.current.originalContents.get('a.ts')).toBe('const old = 1')
  })

  it('stays reverted when a replace-all on other files finishes after the revert', async () => {
    const { result } = renderHarness({
      index: indexOf({ 'f.ts': 'old f', 'g.ts': 'old g' }),
      tabs: [openTab('f.ts', 'old f')],
      searchResults: [match('g.ts', 1)],
      slowPath: 'g.ts',
    })
    await act(async () => result.current.replaceAllInFile('f.ts'))

    let pending!: Promise<void>
    act(() => { pending = result.current.replaceAllInAllFiles() })
    await act(async () => result.current.revertFile('f.ts'))
    await act(async () => { releaseSlowRead(); await pending })

    expect(result.current.codeIndex.files.get('f.ts')?.content).toBe('old f')
    expect(result.current.codeIndex.files.get('g.ts')?.content).toBe('new g')
    expect(result.current.modifiedContents).toEqual(new Map([['g.ts', 'new g']]))
    expect(result.current.originalContents).toEqual(new Map([['g.ts', 'old g']]))
  })

  it('stays reverted when a replace on another file finishes after the revert', async () => {
    const { result } = renderHarness({
      index: indexOf({ 'f.ts': 'old f', 'g.ts': 'old g' }),
      tabs: [openTab('f.ts', 'old f')],
      slowPath: 'g.ts',
    })
    await act(async () => result.current.replaceAllInFile('f.ts'))

    let pending!: Promise<void>
    act(() => { pending = result.current.replaceAllInFile('g.ts') })
    await act(async () => result.current.revertFile('f.ts'))
    await act(async () => { releaseSlowRead(); await pending })

    expect(result.current.codeIndex.files.get('f.ts')?.content).toBe('old f')
    expect(result.current.codeIndex.files.get('g.ts')?.content).toBe('new g')
  })

  it('clears the modified marker of a tab whose edit is no longer tracked at its path', async () => {
    // e.g. a tab left at a.ts after a virtual rename moved its edit to b.ts
    const stale = { ...openTab('a.ts', 'old a'), content: 'new a', isModified: true }
    const { result } = renderHarness({ index: indexOf({ 'b.ts': 'new a' }), tabs: [stale] })

    await act(async () => result.current.revertFile('a.ts'))

    expect(result.current.openTabs[0]).toMatchObject({ content: 'old a', isModified: false })
  })
})
