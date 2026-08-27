import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installFakeWebLocks } from '@/lib/cache/__tests__/fake-web-lock-manager'

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------

const mockStreamUnzipFiles = vi.fn()
const mockFetchFileViaProxy = vi.fn()
const mockDetectLanguage = vi.fn((name: string) => {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'ts' ? 'TypeScript' : ext === 'md' ? 'Markdown' : 'Unknown'
})
const mockMemoryStore = {
  putBatch: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  fallback: true,
}
const mockIDBStore = {
  storeKey: '',
  put: vi.fn(),
  putBatch: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
}
const mockBatchIndexFiles = vi.fn((base, files, options?: { retainContent?: boolean }) => {
  base.contentStore.putBatch(files)
  return {
  files: new Map(files.map((f: { path: string; content: string; language?: string }) => [f.path, {
    path: f.path,
    name: f.path.split('/').pop(),
    ...(options?.retainContent === false ? {} : { content: f.content }),
    language: f.language,
    lineCount: 1,
  }])),
  meta: new Map(files.map((f: { path: string; language?: string }) => [f.path, {
    path: f.path,
    name: f.path.split('/').pop(),
    language: f.language,
    lineCount: 1,
  }])),
  totalFiles: files.length,
  totalLines: 0,
  contentStore: base.contentStore,
  }
})
const mockCreateEmptyIndex = vi.fn(() => ({
  files: new Map(),
  totalFiles: 0,
  totalLines: 0,
  contentStore: mockMemoryStore,
  meta: new Map(),
}))
const mockFlattenFiles = vi.fn((tree) => tree)
const mockSetCachedRepo = vi.fn().mockResolvedValue(undefined)
const mockToastWarning = vi.fn()
const mockGetGitHubCredentialPrincipal = vi.fn<() => string | null>(() => 'oauth:account-a')

vi.mock('@/lib/github/zipball', () => ({
  MAX_FILE_SIZE: 500_000,
  isProbablyBinaryContent: (content: string) => content.includes('\0'),
  streamUnzipFiles: (...args: unknown[]) => mockStreamUnzipFiles(args[0], args[1], args[2]),
  isFileIndexable: (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase()
    return ['ts', 'tsx', 'js', 'md', 'json'].includes(ext ?? '')
  },
}))

vi.mock('@/lib/github/fetcher', () => ({
  detectLanguage: (name: string) => mockDetectLanguage(name),
}))

vi.mock('@/lib/github/client', () => ({
  fetchFileViaProxy: (...args: unknown[]) => mockFetchFileViaProxy(args[0], args[1], args[2], args[3]),
  getGitHubCredentialPrincipal: () => mockGetGitHubCredentialPrincipal(),
}))

vi.mock('@/lib/code/code-index', () => ({
  createEmptyIndex: () => mockCreateEmptyIndex(),
  createEmptyIndexWithStore: (store: unknown) => ({ ...mockCreateEmptyIndex(), contentStore: store }),
  batchIndexFiles: (...args: unknown[]) => mockBatchIndexFiles(
    args[0],
    args[1],
    args[2] as { retainContent?: boolean } | undefined,
  ),
  batchIndexMetadataOnly: vi.fn(),
  flattenFiles: (...args: unknown[]) => mockFlattenFiles(args[0]),
}))

vi.mock('@/lib/code/content-store', () => ({
  IDBContentStore: vi.fn(function IDBContentStore(storeKey: string) {
    mockIDBStore.storeKey = storeKey
    return mockIDBStore
  }),
  InMemoryContentStore: vi.fn(function InMemoryContentStore() {
    return { ...mockMemoryStore, fallback: true }
  }),
  LazyContentStore: vi.fn(),
}))

vi.mock('@/lib/code/fetch-queue', () => ({
  FetchQueue: vi.fn(),
}))

vi.mock('@/lib/cache/repo-cache', () => ({
  getContentStoreKey: (owner: string, repo: string, sha: string) => `${owner}/${repo}@${sha}`,
  publishCachedRepo: (...args: unknown[]) => mockSetCachedRepo(...args.slice(1)),
}))

vi.mock('@/lib/github/fetch-utils', () => ({
  fetchWithConcurrency: vi.fn(async (items, fn) => {
    for (const item of items) {
      await fn(item)
    }
  }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: (...args: unknown[]) => mockToastWarning(...args) },
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
    setCoverage: vi.fn(),
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
    installFakeWebLocks()
    vi.clearAllMocks()
    mockMemoryStore.flush.mockResolvedValue(undefined)
    mockIDBStore.flush.mockResolvedValue(undefined)
    mockSetCachedRepo.mockResolvedValue(undefined)
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

  it('writes the final IDB batch once, flushes it, then publishes the manifest before ready', async () => {
    const callbacks = createCallbacks()
    const repoData = createRepoData({ size: 60_000, isPrivate: true })
    const fileTree = createFileTree([{ path: 'src/index.ts', name: 'index.ts' }])

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    expect(mockIDBStore.put).not.toHaveBeenCalled()
    expect(mockIDBStore.putBatch).toHaveBeenCalledOnce()
    expect(mockIDBStore.flush).toHaveBeenCalledOnce()
    expect(mockBatchIndexFiles).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { retainContent: false },
    )
    expect(mockIDBStore.storeKey).toBe('acme/project@tree-sha')
    const cachedContent = mockSetCachedRepo.mock.calls[0][3]
    expect(cachedContent).toEqual({
      kind: 'idb',
      storeKey: 'acme/project@tree-sha',
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'src/index.ts', lineCount: 1 }),
      ]),
    })
    expect(JSON.stringify(cachedContent)).not.toContain('export const x = 1;')
    expect(mockIDBStore.flush.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetCachedRepo.mock.invocationCallOrder[0],
    )
    expect(mockSetCachedRepo.mock.invocationCallOrder[0]).toBeLessThan(
      callbacks.setLoadingStage.mock.invocationCallOrder.at(-1)!,
    )
    expect(mockSetCachedRepo.mock.calls[0][6]).toEqual(expect.objectContaining({ principal: 'oauth:account-a' }))
  })

  it('does not publish a private manifest when no credential principal is available', async () => {
    mockGetGitHubCredentialPrincipal.mockReturnValueOnce(null)
    const callbacks = createCallbacks()
    const repoData = createRepoData({ isPrivate: true })
    const fileTree = createFileTree([{ path: 'src/index.ts', name: 'index.ts' }])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    expect(mockSetCachedRepo).not.toHaveBeenCalled()
    expect(mockToastWarning).toHaveBeenCalledWith(
      'Repository is ready, but it was not cached for future visits.',
    )
    warnSpy.mockRestore()
  })

  it('keeps the resident index in memory, warns, and skips the manifest when IDB flush fails', async () => {
    mockIDBStore.flush.mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    const callbacks = createCallbacks()
    const repoData = createRepoData({ size: 60_000 })
    const fileTree = createFileTree([{ path: 'src/index.ts', name: 'index.ts' }])

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    expect(mockSetCachedRepo).not.toHaveBeenCalled()
    expect(mockToastWarning).toHaveBeenCalledWith(
      'Repository is ready, but it was not cached for future visits.',
    )
    expect(callbacks.setCodeIndex).toHaveBeenCalledWith(expect.objectContaining({
      contentStore: expect.objectContaining({ fallback: true }),
      totalFiles: 2,
    }))
    expect(callbacks.setLoadingStage).toHaveBeenLastCalledWith('ready')
  })

  it('does not write shared content or a manifest without origin-wide coordination', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    const callbacks = createCallbacks()
    const repoData = createRepoData({ size: 60_000 })
    const fileTree = createFileTree([{ path: 'src/index.ts', name: 'index.ts' }])

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    expect(mockIDBStore.putBatch).not.toHaveBeenCalled()
    expect(mockIDBStore.flush).not.toHaveBeenCalled()
    expect(mockSetCachedRepo).not.toHaveBeenCalled()
    expect(mockToastWarning).toHaveBeenCalledWith(
      'Repository is ready, but it was not cached for future visits.',
    )
    expect(callbacks.setCodeIndex).toHaveBeenCalledWith(expect.objectContaining({
      contentStore: expect.objectContaining({ fallback: true }),
    }))
  })

  it('keeps the resident index usable and warns when manifest publication fails', async () => {
    mockSetCachedRepo.mockRejectedValueOnce(new DOMException('manifest failed', 'UnknownError'))
    const callbacks = createCallbacks()
    const repoData = createRepoData()
    const fileTree = createFileTree([{ path: 'src/index.ts', name: 'index.ts' }])

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    expect(callbacks.setCodeIndex).toHaveBeenCalledWith(expect.objectContaining({ totalFiles: 2 }))
    expect(mockToastWarning).toHaveBeenCalledWith(
      'Repository is ready, but it was not cached for future visits.',
    )
    expect(callbacks.setLoadingStage).toHaveBeenLastCalledWith('ready')
  })

  it('preserves discovered supported count and records ZIP omissions as failures', async () => {
    mockStreamUnzipFiles.mockImplementationOnce(
      async (_response: Response, onFile: (path: string, content: string) => void) => {
        onFile('src/index.ts', 'export const x = 1;')
        return { count: 1, totalSize: 20 }
      },
    )
    const callbacks = createCallbacks()
    const repoData = createRepoData()
    const fileTree = createFileTree([
      { path: 'src/index.ts', name: 'index.ts' },
      { path: 'README.md', name: 'README.md' },
    ])

    await startIndexing(repoData, fileTree, 'tree-sha', signal, callbacks)

    expect(callbacks.setCoverage).toHaveBeenLastCalledWith(expect.objectContaining({
      supportedFiles: { discovered: 2, loaded: 1 },
      failures: {
        count: 1,
        samples: [{ path: 'README.md', error: 'Supported file was not present in the ZIP extraction' }],
      },
    }))
  })
})
