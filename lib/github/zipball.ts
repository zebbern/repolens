// Zipball API — bulk-download all repo files in a single request via GitHub's zipball endpoint.

import { strFromU8, Unzip, UnzipInflate } from 'fflate'

/** Extensions considered indexable for code search and AI context. */
export const INDEXABLE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'cs', 'cpp', 'c', 'h', 'hpp', 'php',
  'vue', 'svelte', 'html', 'css', 'scss', 'sass',
  'json', 'yaml', 'yml', 'md', 'mdx', 'sql', 'graphql',
  'sh', 'bash', 'zsh', 'dockerfile',
])

/** Maximum file size (in bytes) that we'll index. */
const MAX_FILE_SIZE = 500_000

/** Maximum cumulative extracted size (in bytes) before aborting. */
const MAX_TOTAL_EXTRACTED_SIZE = 200_000_000

/**
 * Check whether a file should be indexed based on its extension and size.
 *
 * The `name` parameter can be either a bare filename (`"index.ts"`)
 * or a full path (`"src/utils/index.ts"`) — the extension is extracted
 * from the last segment after the final dot.
 */
export function isFileIndexable(name: string, size: number): boolean {
  if (size > MAX_FILE_SIZE) return false
  const ext = name.split('/').pop()?.split('.').pop()?.toLowerCase()
  return ext ? INDEXABLE_EXTENSIONS.has(ext) : false
}

interface StreamUnzipOptions {
  signal?: AbortSignal
  maxTotalSize?: number
  maxFileSize?: number
}

/**
 * Stream-extract indexable files from a zipball Response using fflate's
 * streaming `Unzip` API. Files are delivered to `onFile` as they are
 * decompressed — no need to buffer the entire zip in memory first.
 *
 * @returns Number of files delivered to `onFile` and total extracted bytes.
 */
export async function streamUnzipFiles(
  response: Response,
  onFile: (path: string, content: string) => void,
  options: StreamUnzipOptions = {},
): Promise<{ count: number; totalSize: number }> {
  const {
    signal,
    maxTotalSize = MAX_TOTAL_EXTRACTED_SIZE,
    maxFileSize = MAX_FILE_SIZE,
  } = options

  if (!response.body) {
    throw new Error('Response has no body to stream')
  }

  let count = 0
  let totalSize = 0
  let aborted = false

  const uz = new Unzip()
  uz.register(UnzipInflate)

  uz.onfile = (file) => {
    // Skip directory entries
    if (file.name.endsWith('/')) return

    // Strip GitHub root directory prefix (owner-repo-sha/)
    const slashIndex = file.name.indexOf('/')
    if (slashIndex === -1) return
    const relativePath = file.name.substring(slashIndex + 1)
    if (!relativePath) return
    if (relativePath.split('/').includes('..')) return

    // Skip non-indexable files (don't call start → fflate skips decompression)
    if (!isFileIndexable(relativePath, 0)) return

    const chunks: Uint8Array[] = []
    let fileSize = 0
    let skipped = false

    file.ondata = (err, data, final) => {
      if (err) {
        console.warn(`fflate: decompression error for ${relativePath}:`, err)
        return
      }
      if (aborted || skipped) return

      fileSize += data.length
      if (fileSize > maxFileSize) {
        skipped = true
        return
      }

      chunks.push(data)

      if (final) {
        const total = chunks.reduce((a, c) => a + c.length, 0)
        const result = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.length
        }

        const content = strFromU8(result)
        totalSize += content.length
        if (totalSize > maxTotalSize) {
          aborted = true
          console.warn(`Streaming zipball extraction exceeded ${maxTotalSize} bytes — stopping`)
          return
        }

        count++
        onFile(relativePath, content)
      }
    }

    file.start()
  }

  const reader = response.body.getReader()
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        throw new DOMException('The operation was aborted.', 'AbortError')
      }

      const { done, value } = await reader.read()
      if (done) {
        uz.push(new Uint8Array(0), true)
        break
      }

      if (aborted) {
        await reader.cancel()
        break
      }

      uz.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }

  return { count, totalSize }
}
