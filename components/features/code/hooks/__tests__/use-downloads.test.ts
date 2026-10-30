import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { strFromU8, zipSync } from 'fflate'
import { createEmptyIndex } from '@/lib/code/code-index'
import { clearGitHubCache, setGitHubPAT } from '@/lib/github/client'
import type { FileNode, GitHubRepo } from '@/types/repository'
import { useDownloads } from '../use-downloads'

vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>()
  return { ...actual, zipSync: vi.fn(actual.zipSync) }
})

describe('useDownloads genuine empty modified files', () => {
  const createdBlobs: Blob[] = []
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  let originalClick: typeof HTMLAnchorElement.prototype.click

  beforeEach(() => {
    createdBlobs.length = 0
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    originalClick = HTMLAnchorElement.prototype.click
    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob)
      return `blob:download-${createdBlobs.length}`
    })
    URL.revokeObjectURL = vi.fn()
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    HTMLAnchorElement.prototype.click = originalClick
  })

  function renderDownloads() {
    return renderHook(() => useDownloads({
      modifiedContents: new Map([['src/empty.ts', '']]),
      openTabs: [],
      codeIndex: createEmptyIndex(),
      files: [],
      getFileContent: async () => null,
      repo: null,
    }))
  }

  it('downloads a single modified file whose content is genuinely empty', () => {
    const { result } = renderDownloads()

    act(() => result.current.downloadFile(result.current.modifiedTabs[0]))

    expect(createdBlobs).toHaveLength(1)
    expect(createdBlobs[0].size).toBe(0)
  })

  it('includes a genuinely empty modified file in the changes ZIP', async () => {
    const { result } = renderDownloads()

    await act(async () => result.current.downloadAllModified())
    const archive = vi.mocked(zipSync).mock.calls[0][0] as Record<string, Uint8Array>

    expect(Object.keys(archive)).toContain('src/empty.ts')
    expect(archive['src/empty.ts']).toHaveLength(0)
  })
})

describe('useDownloads private-repository files missing from the index', () => {
  const PAT = 'ghp_private_downloads'
  const PRIVATE_REPO: GitHubRepo = {
    owner: 'acme',
    name: 'secret',
    fullName: 'acme/secret',
    description: null,
    defaultBranch: 'main',
    stars: 0,
    forks: 0,
    language: 'TypeScript',
    topics: [],
    isPrivate: true,
    url: 'https://github.com/acme/secret',
    openIssuesCount: 0,
    pushedAt: '2026-10-01T00:00:00Z',
    license: null,
  }
  const INDEXED: Record<string, string> = { 'src/indexed.ts': 'export const indexed = 1\n' }
  const REMOTE: Record<string, string> = {
    'src/remote.ts': 'export const remote = 2\n',
    'README.md': '# secret\n',
  }
  const SRC: FileNode = {
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      { name: 'indexed.ts', path: 'src/indexed.ts', type: 'file' },
      { name: 'remote.ts', path: 'src/remote.ts', type: 'file' },
    ],
  }
  const FILES: FileNode[] = [SRC, { name: 'README.md', path: 'README.md', type: 'file' }]

  const createdBlobs: Blob[] = []
  const fetchMock = vi.fn()
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL

  /**
   * GitHub hides a private repository from unauthenticated requests; the
   * RepoLens file route reads it with the token the client forwards.
   */
  async function fakeNetwork(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = String(input)
    const headers = new Headers(init.headers)
    // A public repository: raw content needs no token, while the RepoLens route is rate limited.
    if (url.startsWith('https://raw.githubusercontent.com/acme/oss/')) {
      const path = decodeURIComponent(url.split('/main/')[1] ?? '')
      return path in REMOTE ? new Response(REMOTE[path]) : new Response('404: Not Found', { status: 404 })
    }
    if (url.startsWith('/api/github/file?') && new URL(url, 'http://localhost').searchParams.get('name') === 'oss') {
      return Response.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 })
    }
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      const path = decodeURIComponent(url.split('/main/')[1] ?? '')
      return headers.get('Authorization') === `Bearer ${PAT}` && path in REMOTE
        ? new Response(REMOTE[path])
        : new Response('404: Not Found', { status: 404, statusText: 'Not Found' })
    }
    if (url.startsWith('/api/github/file?')) {
      const params = new URL(url, 'http://localhost').searchParams
      const path = params.get('path') ?? ''
      return headers.get('X-GitHub-Token') === PAT && params.get('owner') === 'acme' && path in REMOTE
        ? Response.json({ content: REMOTE[path] })
        : Response.json({ error: { code: 'GITHUB_ERROR', message: 'Failed to fetch file' } }, { status: 500 })
    }
    return new Response(null, { status: 404 })
  }

  beforeEach(() => {
    createdBlobs.length = 0
    vi.mocked(zipSync).mockClear()
    fetchMock.mockReset()
    fetchMock.mockImplementation(fakeNetwork)
    vi.stubGlobal('fetch', fetchMock)
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob)
      return `blob:download-${createdBlobs.length}`
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    clearGitHubCache()
    setGitHubPAT(PAT)
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    setGitHubPAT(null)
    vi.unstubAllGlobals()
  })

  function renderPrivateDownloads() {
    return renderHook(() => useDownloads({
      modifiedContents: new Map(),
      openTabs: [],
      codeIndex: createEmptyIndex(),
      files: FILES,
      getFileContent: async (path: string) => INDEXED[path] ?? null,
      repo: PRIVATE_REPO,
    }))
  }

  function lastArchive(): Record<string, string> {
    const archive = vi.mocked(zipSync).mock.lastCall?.[0] as Record<string, Uint8Array>
    return Object.fromEntries(Object.entries(archive).map(([path, bytes]) => [path, strFromU8(bytes)]))
  }

  function fileRequests(): Array<{ url: string; token: string | null }> {
    return fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      token: new Headers((init as RequestInit | undefined)?.headers).get('X-GitHub-Token'),
    }))
  }

  it('downloads a file that is not in the index through the proxy with the forwarded token', async () => {
    const { result } = renderPrivateDownloads()

    await act(async () => result.current.downloadExplorerFile({ name: 'remote.ts', path: 'src/remote.ts', type: 'file' }))

    expect(createdBlobs).toHaveLength(1)
    await expect(createdBlobs[0].text()).resolves.toBe(REMOTE['src/remote.ts'])
    expect(fileRequests()).toEqual([
      { url: expect.stringMatching(/^\/api\/github\/file\?/), token: PAT },
    ])
  })

  it('includes files that are not in the index in a folder ZIP', async () => {
    const { result } = renderPrivateDownloads()

    await act(async () => result.current.downloadExplorerFolder(SRC))

    expect(lastArchive()).toEqual({
      'indexed.ts': INDEXED['src/indexed.ts'],
      'remote.ts': REMOTE['src/remote.ts'],
    })
  })

  it('includes files that are not in the index in the full-project ZIP', async () => {
    const { result } = renderPrivateDownloads()

    await act(async () => result.current.downloadFullProject())

    expect(lastArchive()).toEqual({
      'src/indexed.ts': INDEXED['src/indexed.ts'],
      'src/remote.ts': REMOTE['src/remote.ts'],
      'README.md': REMOTE['README.md'],
    })
    expect(fileRequests().every(request => request.token === PAT)).toBe(true)
  })

  it('reads missing public-repository files straight from GitHub, not through the rate-limited route', async () => {
    const { result } = renderHook(() => useDownloads({
      modifiedContents: new Map(),
      openTabs: [],
      codeIndex: createEmptyIndex(),
      files: FILES,
      getFileContent: async (path: string) => INDEXED[path] ?? null,
      repo: { ...PRIVATE_REPO, name: 'oss', fullName: 'acme/oss', isPrivate: false },
    }))

    await act(async () => result.current.downloadFullProject())

    expect(lastArchive()).toEqual({
      'src/indexed.ts': INDEXED['src/indexed.ts'],
      'src/remote.ts': REMOTE['src/remote.ts'],
      'README.md': REMOTE['README.md'],
    })
  })
})
