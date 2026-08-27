import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the parser module
vi.mock('../parser', () => ({
  buildRepoApiUrl: (owner: string, repo: string) =>
    `https://api.github.com/repos/${owner}/${repo}`,
  buildTreeApiUrl: vi.fn(),
  buildRawContentUrl: vi.fn(),
}))

// Mock the graphql module
vi.mock('../graphql', () => ({
  githubGraphQL: vi.fn(),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  fetchFileContent,
  fetchRepoMetadata,
  fetchRepoTree,
  fetchTags,
  GitHubResponseTooLargeError,
  MAX_FILE_RESPONSE_BYTES,
} from '../fetcher'

describe('fetcher error messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws with "add a GitHub token in Settings" for 404 responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    await expect(fetchRepoMetadata('owner', 'private-repo')).rejects.toThrow(
      'add a GitHub token in Settings',
    )
  })

  it('throws with "add a GitHub Personal Access Token in Settings" for 403 responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    })

    await expect(fetchRepoMetadata('owner', 'repo')).rejects.toThrow(
      'add a GitHub Personal Access Token in Settings',
    )
  })

  it('does NOT mention "is public" in the 404 error message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    await expect(fetchRepoMetadata('owner', 'repo')).rejects.not.toThrow(
      'is public',
    )
  })

  it('throws generic error for other status codes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    await expect(fetchRepoMetadata('owner', 'repo')).rejects.toThrow(
      'Failed to fetch repository',
    )
  })

  it('cancels a non-OK tree response before returning a partial result', async () => {
    const cancel = vi.fn()
    mockFetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 404,
      statusText: 'Not Found',
    }))

    await expect(fetchRepoTree('owner', 'repo', 'main')).resolves.toMatchObject({ status: 'partial' })
    expect(cancel).toHaveBeenCalled()
  })

  it('cancels a non-OK file response before throwing', async () => {
    const cancel = vi.fn()
    mockFetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 404,
      statusText: 'Not Found',
    }))

    await expect(fetchFileContent('owner', 'repo', 'main', 'src/missing.ts')).rejects.toThrow('Not Found')
    expect(cancel).toHaveBeenCalled()
  })

  it('cancels non-OK metadata and shared-handler responses before throwing', async () => {
    const metadataCancel = vi.fn()
    const tagsCancel = vi.fn()
    mockFetch
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel: metadataCancel }), {
        status: 404,
        statusText: 'Not Found',
      }))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel: tagsCancel }), {
        status: 403,
        statusText: 'Forbidden',
      }))

    await expect(fetchRepoMetadata('owner', 'repo')).rejects.toThrow('Repository not found')
    await expect(fetchTags('owner', 'repo')).rejects.toThrow('Rate limit exceeded')
    expect(metadataCancel).toHaveBeenCalled()
    expect(tagsCancel).toHaveBeenCalled()
  })

  it('rejects a chunked file body over the size limit and cancels the upstream stream', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_FILE_RESPONSE_BYTES))
        controller.enqueue(new Uint8Array(1))
      },
      cancel,
    })
    mockFetch.mockResolvedValueOnce(new Response(body, { status: 200 }))

    await expect(fetchFileContent('owner', 'repo', 'main', 'src/file.ts')).rejects.toBeInstanceOf(
      GitHubResponseTooLargeError,
    )
    expect(cancel).toHaveBeenCalled()
  })

  it('preserves the size error when stream cancellation rejects', async () => {
    const cancelError = new Error('upstream cancellation failed')
    const cancel = vi.fn(() => Promise.reject(cancelError))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_FILE_RESPONSE_BYTES))
        controller.enqueue(new Uint8Array(1))
      },
      cancel,
    })
    mockFetch.mockResolvedValueOnce(new Response(body, { status: 200 }))

    await expect(fetchFileContent('owner', 'repo', 'main', 'src/file.ts')).rejects.toBeInstanceOf(
      GitHubResponseTooLargeError,
    )
    expect(cancel).toHaveBeenCalled()
  })

  it('cancels a declared oversized file body before rejecting', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    mockFetch.mockResolvedValueOnce(new Response(body, {
      status: 200,
      headers: { 'Content-Length': String(MAX_FILE_RESPONSE_BYTES + 1) },
    }))

    await expect(fetchFileContent('owner', 'repo', 'main', 'src/file.ts')).rejects.toBeInstanceOf(
      GitHubResponseTooLargeError,
    )
    expect(cancel).toHaveBeenCalled()
  })

  it('returns a partial tree and cancels an oversized declared tree body', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    mockFetch.mockResolvedValueOnce(new Response(body, {
      status: 200,
      headers: { 'Content-Length': String(8 * 1024 * 1024 + 1) },
    }))

    const result = await fetchRepoTree('owner', 'repo', 'main')

    expect(result).toMatchObject({ status: 'partial', reasons: ['limit-exceeded'] })
    expect(cancel).toHaveBeenCalled()
  })
})
