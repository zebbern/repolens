import { describe, it, expect, vi, beforeEach } from 'vitest'
import { downloadFile } from './download'

describe('downloadFile', () => {
  let mockClick = vi.fn<() => void>()
  let appendedElement: HTMLAnchorElement | null

  beforeEach(() => {
    mockClick = vi.fn()
    appendedElement = null

    // Mock URL.createObjectURL / revokeObjectURL
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
      revokeObjectURL: vi.fn(),
    })

    // Intercept anchor creation
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const el = origCreateElement('a') as HTMLAnchorElement
        el.click = mockClick
        appendedElement = el
        return el
      }
      return origCreateElement(tag)
    })

    vi.spyOn(document.body, 'appendChild').mockImplementation(node => node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(node => node)
  })

  it('creates a Blob with the correct content and MIME type', () => {
    downloadFile({
      content: '{"key":"value"}',
      filename: 'test.json',
      mimeType: 'application/json',
    })

    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'application/json' }),
    )
  })

  it('sets the anchor href to the blob URL', () => {
    downloadFile({
      content: 'hello',
      filename: 'test.txt',
      mimeType: 'text/plain',
    })

    expect(appendedElement).not.toBeNull()
    expect(appendedElement!.href).toContain('blob:mock-url')
  })

  it('sets the download attribute to the sanitized filename', () => {
    downloadFile({
      content: 'data',
      filename: 'my-report.md',
      mimeType: 'text/markdown',
    })

    expect(appendedElement!.download).toBe('my-report.md')
  })

  it('sanitizes filenames with invalid characters', () => {
    downloadFile({
      content: 'data',
      filename: 'file<name>:test.txt',
      mimeType: 'text/plain',
    })

    // Invalid chars should be replaced with hyphens
    expect(appendedElement!.download).toBe('file-name--test.txt')
  })

  it('clicks the anchor to trigger download', () => {
    downloadFile({
      content: 'data',
      filename: 'test.txt',
      mimeType: 'text/plain',
    })

    expect(mockClick).toHaveBeenCalledOnce()
  })

  it('revokes the blob URL after download', () => {
    downloadFile({
      content: 'data',
      filename: 'test.txt',
      mimeType: 'text/plain',
    })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('cleans up the anchor element from the DOM', () => {
    downloadFile({
      content: 'data',
      filename: 'test.txt',
      mimeType: 'text/plain',
    })

    expect(document.body.appendChild).toHaveBeenCalled()
    expect(document.body.removeChild).toHaveBeenCalled()
  })
})
