import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------

const mockStreamUnzipFiles = vi.fn()
const mockFetchFileViaProxy = vi.fn()
const mockDetectLanguage = vi.fn((name: string) => {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'ts' ? 'TypeScript' : ext === 'md' ? 'Markdown' : 'Unknown'
})
const mockBatchIndexFiles = vi.fn((_base, files) => ({
  files: new Map(files.map((f: { path: string; content: string }) => [f.path, { path: f.path, name: f.path.split('/').pop(), content: f.content }])),
  totalFiles: files.length,
  totalLines: 0,
}))
const mockCreateEmptyIndex = vi.fn(() => ({
  files: new Map(),
  totalFiles: 0,
  totalLines: 0,
}))
const mockFlattenFiles = vi.fn((tree) => tree)
const mockSetCachedRepo = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/github/zipball', () => ({
  streamUnzipFiles: (...args: unknown[]) => mockStreamUnzipFiles(...args),
  isFileIndexable: (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase()
    return ['ts', 'tsx', 'js', 'md', 'json'].includes(ext ?? '')
  },
}))

vi.mock('@/lib/github/fetcher', () => ({
  detectLanguage: (...args: unknown[]) => mockDetectLanguage(...args),
}))

vi.mock('@/lib/github/client', () => ({
  fetchFileViaProxy: (...args: unknown[]) => mockFetchFileViaProxy(...args),
}))

vi.mock('@/lib/code/code-index', () => ({
  createEmptyIndex: (...args: unknown[]) => mockCreateEmptyIndex(...args),
  createEmptyIndexWithStore: (...args: unknown[]) => mockCreateEmptyIndex(...args),
  batchIndexFiles: (...args: unknown[]) => mockBatchIndexFiles(...args),
  batchIndexMetadataOnly: vi.fn(),
  flattenFiles: (...args: unknown[]) => mockFlattenFiles(...args),
}))

vi.mock('@/lib/code/content-store', () => ({
  IDBContentStore: vi.fn(() => ({
    put: vi.fn(),
  })),
  LazyContentStore: vi.fn(),
}))

vi.mock('@/lib/code/fetch-queue', () => ({
  FetchQueue: vi.fn(),
}))

vi.mock('@/lib/cache/repo-cache', () => ({
  setCachedRepo: (...args: unknown[]) => mockSetCachedRepo(...args),
}))

vi.mock('@/lib/github/fetch-utils', () => ({
  fetchWithConcurrency: vi.fn(async (items, fn) => {
    for (const item of items) {
      await fn(item)
    }
  }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

import { startIndexing } from '@/lib/github/indexing-pipeline'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCallbacks() {
  return {
    setIndexingProgress: vi.fn(),
    setLoadingStage: vi.fn(),
    setCodeIndex: vi.fn(),
    setFailedFiles: vi.fn(),
  }
}

function createRepoData(overrides: Record<string, unknown> = {}) {
  return {
    owner: 'acme',
    name: 'project',
    defaultBranch: 'main',
    description: 'Test repo',
    stars: 100,
    language: 'TypeScript',
    size: 1000, // 1 MB — well under lazy threshold, under IDB threshold
    ...overrides,
  } as Parameters<typeof startIndexing>[0]
}

function createFileTree(files: Array<{ path: string; name: string; size?: number }>) {
  return files.map(f => ({
    path: f.path,
    name: f.name,
    type: 'file' as const,
    size: f.size ?? 100,
    language: undefined,
    children: undefined,
  }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startIndexing — streaming pipeline', () => {
  const signal = new AbortController().signal

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: streamUnzipFiles succeeds and calls onFile for each file
    mockStreamUnzipFiles.mockImplementation(
      async (_response: Response, onFile: (path: string, content: string) => void) => {
        onFile('src/index.ts', 'export const x = 1;')
        onFile('README.md', '# Hello')
        return { count: 2, totalSize: 30 }
      },
    )
    // Default: fetch for the zipball proxy route
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('fake-zip', { status: 200 }),
    )
  })

  it('calls streamUnzipFiles for repos under the lazy content threshold', async () => {
    const callbacks = createCallbacks()
    const repoData = createRepoData({ size: 5000 }) // 5 MB
    const fileTree = createFileTree([
      { path: 'src/index.ts', name: 'index.ts' },
      { path: 'README.md', name: 'README.md' },
    ])

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    expect(mockStreamUnzipFiles).toHaveBeenCalledOnce()
    // The first arg is the Response from the proxy fetch
    const responseArg = mockStreamUnzipFiles.mock.calls[0][0]
    expect(responseArg).toBeInstanceOf(Response)
  })

  it('accumulates files from streamUnzipFiles and passes them to batchIndexFiles', async () => {
    const callbacks = createCallbacks()
    const repoData = createRepoData()
    const fileTree = createFileTree([
      { path: 'src/index.ts', name: 'index.ts' },
    ])

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    expect(mockBatchIndexFiles).toHaveBeenCalledOnce()
    const [, accumulated] = mockBatchIndexFiles.mock.calls[0]
    expect(accumulated).toHaveLength(2) // index.ts + README.md from the mock
    expect(accumulated[0].path).toBe('src/index.ts')
    expect(accumulated[0].content).toBe('export const x = 1;')
  })

  it('falls back to per-file fetch when streamUnzipFiles throws', async () => {
    mockStreamUnzipFiles.mockRejectedValueOnce(new Error('Zipball download failed'))
    mockFetchFileViaProxy.mockResolvedValue('file content')

    const callbacks = createCallbacks()
    const repoData = createRepoData()
    const fileTree = createFileTree([
      { path: 'src/index.ts', name: 'index.ts' },
      { path: 'lib/utils.ts', name: 'utils.ts' },
    ])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    // streamUnzipFiles was attempted
    expect(mockStreamUnzipFiles).toHaveBeenCalledOnce()
    // Fell back to per-file fetch
    expect(mockFetchFileViaProxy).toHaveBeenCalledTimes(2)
    expect(mockFetchFileViaProxy).toHaveBeenCalledWith('acme', 'project', 'main', 'src/index.ts')
    expect(mockFetchFileViaProxy).toHaveBeenCalledWith('acme', 'project', 'main', 'lib/utils.ts')
    // batchIndexFiles was still called with the per-file results
    expect(mockBatchIndexFiles).toHaveBeenCalledOnce()

    warnSpy.mockRestore()
  })

  it('sets loading stage to ready after successful indexing', async () => {
    const callbacks = createCallbacks()
    const repoData = createRepoData()
    const fileTree = createFileTree([
      { path: 'src/index.ts', name: 'index.ts' },
    ])

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    const stages = callbacks.setLoadingStage.mock.calls.map((c: unknown[]) => c[0])
    expect(stages[stages.length - 1]).toBe('ready')
  })
})
