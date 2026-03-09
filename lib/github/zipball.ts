// Zipball API — bulk-download all repo files in a single request via GitHub's zipball endpoint.

import { unzip, strFromU8, Unzip, UnzipInflate } from 'fflate'

/** Extensions considered indexable for code search and AI context. */
export const INDEXABLE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'cs', 'cpp', 'c', 'h', 'hpp', 'php',
  'vue', 'svelte', 'html', 'css', 'scss', 'sass',
  'json', 'yaml', 'yml', 'md', 'mdx', 'sql', 'graphql',
  'sh', 'bash', 'zsh', 'dockerfile',
])

/**
 * Wrap fflate's callback-based `unzip()` in a Promise.
 * The async API auto-spawns Web Workers for parallel decompression.
 */
function unzipAsync(
  data: Uint8Array,
  filter?: (file: { name: string; originalSize: number }) => boolean,
): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, filter ? { filter } : {}, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

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

interface ZipballOptions {
  signal?: AbortSignal
  token?: string
}

/**
 * Fetch an entire repository as a zipball and extract indexable file contents.
 *
 * GitHub returns the archive from `codeload.github.com` via a 302 redirect.
 * The zip contains a single top-level directory `{owner}-{repo}-{sha}/`
 * that is stripped when building the returned path→content map.
 *
 * @returns Map of relative file path → file content string (only indexable files).
 */
export async function fetchRepoZipball(
  owner: string,
  repo: string,
  ref: string,
  options: ZipballOptions = {},
): Promise<Map<string, string>> {
  // Proxy through our own API route to avoid CORS issues.
  // The proxy extracts the auth token from the session cookie server-side.
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (options.token) {
    headers['X-GitHub-Token'] = options.token
  }

  const response = await fetch('/api/github/zipball', {
    method: 'POST',
    headers,
    body: JSON.stringify({ owner, repo, ref }),
    signal: options.signal,
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Repository not found or zipball unavailable')
    }
    if (response.status === 403) {
      throw new Error('Rate limit exceeded or repository is private')
    }
    throw new Error(`Zipball download failed: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const data = new Uint8Array(arrayBuffer)

  // Use fflate's async unzip with a filter that skips non-indexable files
  // BEFORE decompression — this avoids wasting CPU on files we'd discard anyway.
  const extracted = await unzipAsync(data, (file) => {
    // Skip directory entries (paths ending in /)
    if (file.name.endsWith('/')) return false

    // Strip root prefix and check extension
    const slashIndex = file.name.indexOf('/')
    if (slashIndex === -1) return false

    const relativePath = file.name.substring(slashIndex + 1)
    if (!relativePath) return false

    const ext = relativePath.split('/').pop()?.split('.').pop()?.toLowerCase()
    return ext ? INDEXABLE_EXTENSIONS.has(ext) : false
  })

  const files = new Map<string, string>()
  // 200 MB cumulative limit (uses module-level constant)
  let totalExtracted = 0

  // GitHub zipball wraps everything in a top-level directory: {owner}-{repo}-{sha}/
  // We strip this prefix so paths are relative to the repo root.
  for (const [zipPath, rawContent] of Object.entries(extracted)) {
    const slashIndex = zipPath.indexOf('/')
    if (slashIndex === -1) continue

    const relativePath = zipPath.substring(slashIndex + 1)
    if (!relativePath) continue
    if (relativePath.split('/').includes('..')) continue

    const content = strFromU8(rawContent)

    // Skip files that exceed the per-file size limit
    if (content.length > MAX_FILE_SIZE) continue

    totalExtracted += content.length
    if (totalExtracted > MAX_TOTAL_EXTRACTED_SIZE) {
      console.warn(`Zipball extraction exceeded ${MAX_TOTAL_EXTRACTED_SIZE} bytes — aborting remaining files`)
      return files
    }

    files.set(relativePath, content)
  }

  return files
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
