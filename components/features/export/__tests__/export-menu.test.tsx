import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock providers
vi.mock('@/providers', () => ({
  useRepository: () => ({
    repo: {
      fullName: 'owner/repo',
      url: 'https://github.com/owner/repo',
    },
    codeIndex: {
      totalFiles: 10,
      files: new Map(),
    },
    codebaseAnalysis: { files: new Map() },
  }),
}))

vi.mock('@/lib/code/issue-scanner', () => ({
  scanIssues: vi.fn(() => ({
    issues: [],
    summary: { total: 0, critical: 0, warning: 0, info: 0 },
  })),
}))

vi.mock('@/lib/diagrams/diagram-data', () => ({
  generateProjectSummary: vi.fn(() => ({ data: null })),
}))

const mockDownloadFile = vi.fn<(...args: any[]) => void>()
const mockCopyToClipboard = vi.fn<(...args: any[]) => Promise<boolean>>().mockResolvedValue(true)
const mockExportToJson = vi.fn<(...args: any[]) => string>(() => '{}')
const mockExportToMarkdown = vi.fn<(...args: any[]) => string>(() => '# Report')
const mockExportSummaryClipboard = vi.fn<(...args: any[]) => string>(() => 'Summary text')
const mockBuildShareableUrl = vi.fn<(...args: any[]) => string>(() => 'https://example.com/share')

vi.mock('@/lib/export', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...(args as Parameters<typeof mockDownloadFile>)),
  copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...(args as Parameters<typeof mockCopyToClipboard>)),
  exportToJson: (...args: unknown[]) => mockExportToJson(...(args as Parameters<typeof mockExportToJson>)),
  exportToMarkdown: (...args: unknown[]) => mockExportToMarkdown(...(args as Parameters<typeof mockExportToMarkdown>)),
  exportSummaryClipboard: (...args: unknown[]) => mockExportSummaryClipboard(...(args as Parameters<typeof mockExportSummaryClipboard>)),
  buildShareableUrl: (...args: unknown[]) => mockBuildShareableUrl(...(args as Parameters<typeof mockBuildShareableUrl>)),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { ExportMenu } from '../export-menu'

describe('ExportMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the export trigger button', () => {
    render(<ExportMenu />)
    const btn = screen.getByTitle('Export & Share')
    expect(btn).toBeInTheDocument()
  })

  it('enables the trigger button when repo data is available', () => {
    render(<ExportMenu />)
    const btn = screen.getByTitle('Export & Share')
    expect(btn).not.toBeDisabled()
  })

  it('shows dropdown menu on click', async () => {
    const user = userEvent.setup()
    render(<ExportMenu />)

    await user.click(screen.getByTitle('Export & Share'))

    expect(screen.getByText('Download JSON')).toBeInTheDocument()
    expect(screen.getByText('Download Markdown')).toBeInTheDocument()
    expect(screen.getByText('Copy Summary')).toBeInTheDocument()
    expect(screen.getByText('Copy Shareable Link')).toBeInTheDocument()
  })

  it('calls exportToJson and downloadFile when Download JSON is clicked', async () => {
    const user = userEvent.setup()
    render(<ExportMenu />)

    await user.click(screen.getByTitle('Export & Share'))
    await user.click(screen.getByText('Download JSON'))

    expect(mockExportToJson).toHaveBeenCalled()
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '{}',
        mimeType: 'application/json',
      })
    )
  })

  it('calls exportToMarkdown and downloadFile when Download Markdown is clicked', async () => {
    const user = userEvent.setup()
    render(<ExportMenu />)

    await user.click(screen.getByTitle('Export & Share'))
    await user.click(screen.getByText('Download Markdown'))

    expect(mockExportToMarkdown).toHaveBeenCalled()
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '# Report',
        mimeType: 'text/markdown',
      })
    )
  })

  it('calls copyToClipboard when Copy Summary is clicked', async () => {
    const user = userEvent.setup()
    render(<ExportMenu />)

    await user.click(screen.getByTitle('Export & Share'))
    await user.click(screen.getByText('Copy Summary'))

    expect(mockExportSummaryClipboard).toHaveBeenCalled()
    expect(mockCopyToClipboard).toHaveBeenCalledWith('Summary text')
  })

  it('calls buildShareableUrl and copyToClipboard when Copy Shareable Link is clicked', async () => {
    const user = userEvent.setup()
    render(<ExportMenu activeTab="repo" />)

    await user.click(screen.getByTitle('Export & Share'))
    await user.click(screen.getByText('Copy Shareable Link'))

    expect(mockBuildShareableUrl).toHaveBeenCalled()
    expect(mockCopyToClipboard).toHaveBeenCalledWith('https://example.com/share')
  })
})


