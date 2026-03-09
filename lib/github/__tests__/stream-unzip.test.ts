// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { streamUnzipFiles } from '../zipball'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ZIP buffer mimicking GitHub's zipball structure, then wrap in a
 * streaming Response. GitHub wraps everything in `{owner}-{repo}-{sha}/`.
 */
function createZipResponse(
  files: Record<string, string | Uint8Array>,
  rootPrefix = 'owner-repo-abc123',
): Response {
  const archive: Record<string, Uint8Array> = {}
  for (const [path, content] of Object.entries(files)) {
    archive[`${rootPrefix}/${path}`] = typeof content === 'string' ? strToU8(content) : content
  }
  const compressed = zipSync(archive)
  return new Response(new Blob([compressed]).stream())
}

/**
 * Split a Uint8Array into chunks of `size` bytes and deliver them through
 * a ReadableStream with one enqueue per chunk — exercises chunk-boundary
 * handling in the streaming decompressor.
 */
function createChunkedZipResponse(
  files: Record<string, string>,
  chunkSize: number,
  rootPrefix = 'owner-repo-abc123',
): Response {
  const archive: Record<string, Uint8Array> = {}
  for (const [path, content] of Object.entries(files)) {
    archive[`${rootPrefix}/${path}`] = strToU8(content)
  }
  const compressed = zipSync(archive)
  const buf = compressed.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < buf.length; i += chunkSize) {
        controller.enqueue(buf.slice(i, i + chunkSize))
      }
      controller.close()
    },
  })

  return new Response(stream)
}

// ---------------------------------------------------------------------------
// streamUnzipFiles
// ---------------------------------------------------------------------------

describe('streamUnzipFiles', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // -- Basic extraction -----------------------------------------------------

  it('calls onFile for each indexable file with correct path and content', async () => {
    const response = createZipResponse({
      'src/index.ts': 'export const x = 1;',
      'src/utils.ts': 'export const add = (a: number, b: number) => a + b;',
      'README.md': '# Hello',
    })

    const received: Array<{ path: string; content: string }> = []
    const result = await streamUnzipFiles(response, (path, content) => {
      received.push({ path, content })
    })

    expect(result.count).toBe(3)
    expect(result.totalSize).toBeGreaterThan(0)

    const paths = received.map(r => r.path).sort()
    expect(paths).toEqual(['README.md', 'src/index.ts', 'src/utils.ts'])

    const idx = received.find(r => r.path === 'src/index.ts')
    expect(idx?.content).toBe('export const x = 1;')
  })

  // -- GitHub root prefix stripping -----------------------------------------

  it('strips the GitHub root directory prefix from paths', async () => {
    const response = createZipResponse(
      { 'deep/nested/file.ts': 'code' },
      'my-org-my-repo-deadbeef',
    )

    const received: string[] = []
    await streamUnzipFiles(response, (path) => {
      received.push(path)
    })

    expect(received).toEqual(['deep/nested/file.ts'])
  })

  // -- Filtering non-indexable files ----------------------------------------

  it('skips non-indexable files (binaries, unsupported extensions)', async () => {
    const response = createZipResponse({
      'src/app.ts': 'const app = true;',
      'assets/logo.png': 'binary-data',
      'fonts/custom.woff': 'font-data',
      'build/output.exe': 'exe-data',
    })

    const received: string[] = []
    await streamUnzipFiles(response, (path) => {
      received.push(path)
    })

    expect(received).toEqual(['src/app.ts'])
  })

  // -- MAX_FILE_SIZE enforcement --------------------------------------------

  it('skips files exceeding MAX_FILE_SIZE (500KB)', async () => {
    const oversizedContent = 'x'.repeat(500_001)
    const response = createZipResponse({
      'small.ts': 'const x = 1;',
      'huge.ts': oversizedContent,
    })

    const received: string[] = []
    const result = await streamUnzipFiles(response, (path) => {
      received.push(path)
    })

    expect(received).toEqual(['small.ts'])
    expect(result.count).toBe(1)
  })

  // -- maxTotalSize enforcement ---------------------------------------------

  it('stops extracting when maxTotalSize is exceeded', async () => {
    // Create multiple files that together exceed the limit
    const fileContent = 'a'.repeat(100)
    const response = createZipResponse({
      'file1.ts': fileContent,
      'file2.ts': fileContent,
      'file3.ts': fileContent,
      'file4.ts': fileContent,
      'file5.ts': fileContent,
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const received: string[] = []
    const result = await streamUnzipFiles(
      response,
      (path) => { received.push(path) },
      { maxTotalSize: 250 }, // 2.5 files worth
    )

    // Should have stopped before processing all 5 files
    expect(result.count).toBeLessThan(5)
    expect(result.count).toBeGreaterThanOrEqual(2)
    expect(received.length).toBe(result.count)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('exceeded'),
    )
  })

  // -- Multi-chunk delivery -------------------------------------------------

  it('handles zip data delivered in small chunks across chunk boundaries', async () => {
    const response = createChunkedZipResponse(
      {
        'src/index.ts': 'export const hello = "world";',
        'src/utils.ts': 'export function add(a: number, b: number) { return a + b; }',
      },
      // 256-byte chunks to ensure boundary splitting
      256,
    )

    const received: Array<{ path: string; content: string }> = []
    const result = await streamUnzipFiles(response, (path, content) => {
      received.push({ path, content })
    })

    expect(result.count).toBe(2)
    const idx = received.find(r => r.path === 'src/index.ts')
    expect(idx?.content).toBe('export const hello = "world";')
    const utils = received.find(r => r.path === 'src/utils.ts')
    expect(utils?.content).toBe('export function add(a: number, b: number) { return a + b; }')
  })

  // -- AbortSignal cancellation ---------------------------------------------

  it('rejects with AbortError when signal is aborted mid-stream', async () => {
    const controller = new AbortController()

    // Create a slow-drip stream that we can abort mid-way
    const archive: Record<string, Uint8Array> = {}
    for (let i = 0; i < 20; i++) {
      archive[`owner-repo-abc123/file${i}.ts`] = strToU8(`content ${i}`)
    }
    const compressed = zipSync(archive)

    let chunkIndex = 0
    const chunkSize = 64
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        const start = chunkIndex * chunkSize
        if (start >= compressed.length) {
          ctrl.close()
          return
        }
        ctrl.enqueue(compressed.slice(start, start + chunkSize))
        chunkIndex++

        // Abort after delivering a few chunks
        if (chunkIndex === 3) {
          controller.abort()
        }
      },
    })

    const response = new Response(stream)

    await expect(
      streamUnzipFiles(response, () => {}, { signal: controller.signal }),
    ).rejects.toThrow('aborted')
  })

  // -- Return value ---------------------------------------------------------

  it('returns count and totalSize matching delivered files', async () => {
    const content1 = 'export const a = 1;'
    const content2 = '# README'
    const response = createZipResponse({
      'a.ts': content1,
      'b.md': content2,
    })

    let totalContentLength = 0
    const result = await streamUnzipFiles(response, (_path, content) => {
      totalContentLength += content.length
    })

    expect(result.count).toBe(2)
    expect(result.totalSize).toBe(totalContentLength)
    expect(result.totalSize).toBe(content1.length + content2.length)
  })

  // -- Empty zip ------------------------------------------------------------

  it('returns { count: 0, totalSize: 0 } for a zip with no indexable files', async () => {
    // Empty zip
    const compressed = zipSync({})
    const response = new Response(new Blob([compressed]).stream())

    const received: string[] = []
    const result = await streamUnzipFiles(response, (path) => {
      received.push(path)
    })

    expect(result).toEqual({ count: 0, totalSize: 0 })
    expect(received).toEqual([])
  })

  it('returns { count: 0, totalSize: 0 } when zip has only non-indexable files', async () => {
    const response = createZipResponse({
      'image.png': 'fake-binary',
      'font.woff': 'fake-font',
    })

    const result = await streamUnzipFiles(response, () => {})

    expect(result).toEqual({ count: 0, totalSize: 0 })
  })

  // -- Error: no body -------------------------------------------------------

  it('throws when response has no body', async () => {
    const response = new Response(null)

    await expect(
      streamUnzipFiles(response, () => {}),
    ).rejects.toThrow('Response has no body')
  })
})
