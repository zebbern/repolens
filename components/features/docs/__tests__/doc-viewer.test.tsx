import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------- Module mocks (must be before component import) ----------

vi.mock('@/providers', () => ({
  useAPIKeys: vi.fn(),
  useRepository: vi.fn(),
  useRepositoryData: vi.fn(),
  useDocs: vi.fn(),
}))

vi.mock('@/hooks/use-docs-engine', () => ({
  useDocsEngine: vi.fn(),
}))

vi.mock('@/providers/docs-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/docs-provider')>()
  return { ...actual }
})

vi.mock('ai', () => ({
  isToolUIPart: vi.fn(() => false),
  getToolName: vi.fn(() => ''),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}))

vi.mock('@/lib/github/fetcher', () => ({
  buildFileTreeString: vi.fn(() => 'mock-tree'),
}))

vi.mock('@/lib/code/code-index', () => ({
  flattenFiles: vi.fn(() => []),
}))

vi.mock('@/lib/export', () => ({
  downloadFile: vi.fn(),
}))

vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}))

// ---------- Imports ----------

import { useAPIKeys, useRepository, useRepositoryData, useDocs } from '@/providers'
import { useDocsEngine } from '@/hooks/use-docs-engine'
import { useIsMobile } from '@/hooks/use-mobile'
import { flattenFiles } from '@/lib/code/code-index'
import { isToolUIPart, getToolName } from 'ai'
import { DocViewer } from '../doc-viewer'

// ---------- Helpers ----------

function createFileList(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `file-${i}.ts`,
    path: `src/file-${i}.ts`,
    type: 'file' as const,
  }))
}

function makeAssistantMessage(text: string, id = 'msg-1') {
  return {
    id,
    role: 'assistant' as const,
    content: text,
    parts: [{ type: 'text' as const, text }],
    createdAt: new Date(),
  }
}

function makeToolMessage(
  toolCalls: { name: string; path?: string; state: string }[],
) {
  return {
    id: `tool-msg-${Date.now()}`,
    role: 'assistant' as const,
    content: '',
    parts: toolCalls.map((tc) => ({
      type: 'tool-invocation' as const,
      toolInvocationId: `tool-${Math.random()}`,
      toolName: tc.name,
      state: tc.state,
      input: { path: tc.path },
    })),
    createdAt: new Date(),
  }
}

const defaultAPIKeysValue = {
  selectedModel: {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai' as const,
  },
  apiKeys: {
    openai: { key: 'test-key', isValid: true, lastValidated: new Date() },
    google: { key: '', isValid: false, lastValidated: null },
    anthropic: { key: '', isValid: false, lastValidated: null },
    openrouter: { key: '', isValid: false, lastValidated: null },
  },
  models: [],
  isLoadingModels: false,
  selectedProvider: 'openai' as const,
  setAPIKey: vi.fn(),
  validateAPIKey: vi.fn(),
  removeAPIKey: vi.fn(),
  fetchModels: vi.fn(),
  setSelectedModel: vi.fn(),
  getValidProviders: vi.fn(() => ['openai' as const]),
  isHydrated: true,
  modelFetchErrors: {},
}

const defaultRepoValue = {
  repo: {
    fullName: 'test/repo',
    name: 'repo',
    description: 'A test repo',
  },
  files: [{ name: 'index.ts', path: 'index.ts', type: 'file' as const }],
  codeIndex: null,
  isLoading: false,
  error: null,
  fetchRepo: vi.fn(),
  clearRepo: vi.fn(),
}

const defaultDocsValue = {
  generatedDocs: [] as ReturnType<typeof makeAssistantMessage>[] & { id: string; type: string; title: string; messages: ReturnType<typeof makeAssistantMessage>[]; createdAt: Date }[],
  activeDocId: null as string | null,
  showNewDoc: true,
  setGeneratedDocs: vi.fn(),
  setActiveDocId: vi.fn(),
  setShowNewDoc: vi.fn(),
  clearDocs: vi.fn(),
}

const defaultDocsEngineValue = {
  generatedDocs: [] as typeof defaultDocsValue.generatedDocs,
  messages: [] as ReturnType<typeof makeAssistantMessage>[],
  status: 'ready' as string,
  error: null as Error | null | undefined,
  isGenerating: false,
  stop: vi.fn(),
  handleGenerate: vi.fn(),
  handleRegenerate: vi.fn(),
  handleDeleteDoc: vi.fn(),
}

interface SetupOptions {
  selectedModel?: (typeof defaultAPIKeysValue)['selectedModel'] | null
  status?: string
  messages?: ReturnType<typeof makeAssistantMessage>[]
  error?: Error | null
  isMobile?: boolean
  files?: { name: string; path: string; type: 'file' | 'directory' }[]
  flatFiles?: { name: string; path: string; type: 'file' | 'directory' }[]
  repo?: (typeof defaultRepoValue)['repo'] | null
  getValidProviders?: () => string[]
  generatedDocs?: { id: string; type: string; title: string; messages: ReturnType<typeof makeAssistantMessage>[]; createdAt: Date; targetFile?: string; customPrompt?: string }[]
  activeDocId?: string | null
  showNewDoc?: boolean
}

function setupMocks(overrides: SetupOptions = {}) {
  const mockStop = vi.fn()
  const mockHandleGenerate = vi.fn()
  const mockHandleRegenerate = vi.fn()
  const mockHandleDeleteDoc = vi.fn()

  const isGenerating = overrides.status === 'streaming' || overrides.status === 'submitted'

  vi.mocked(useAPIKeys).mockReturnValue({
    ...defaultAPIKeysValue,
    ...(overrides.selectedModel !== undefined
      ? { selectedModel: overrides.selectedModel }
      : {}),
    ...(overrides.getValidProviders
      ? { getValidProviders: overrides.getValidProviders }
      : {}),
  } as unknown as ReturnType<typeof useAPIKeys>)

  vi.mocked(useRepository).mockReturnValue({
    ...defaultRepoValue,
    ...(overrides.repo !== undefined ? { repo: overrides.repo } : {}),
    ...(overrides.files ? { files: overrides.files } : {}),
  } as unknown as ReturnType<typeof useRepository>)

  vi.mocked(useRepositoryData).mockReturnValue({
    ...defaultRepoValue,
    ...(overrides.repo !== undefined ? { repo: overrides.repo } : {}),
    ...(overrides.files ? { files: overrides.files } : {}),
  } as unknown as ReturnType<typeof useRepositoryData>)

  vi.mocked(useDocs).mockReturnValue({
    ...defaultDocsValue,
    generatedDocs: overrides.generatedDocs ?? [],
    activeDocId: overrides.activeDocId ?? null,
    showNewDoc: overrides.showNewDoc ?? true,
  } as unknown as ReturnType<typeof useDocs>)

  vi.mocked(useDocsEngine).mockReturnValue({
    ...defaultDocsEngineValue,
    generatedDocs: overrides.generatedDocs ?? [],
    messages: overrides.messages ?? [],
    status: overrides.status ?? 'ready',
    error: overrides.error ?? null,
    isGenerating,
    stop: mockStop,
    handleGenerate: mockHandleGenerate,
    handleRegenerate: mockHandleRegenerate,
    handleDeleteDoc: mockHandleDeleteDoc,
  } as unknown as ReturnType<typeof useDocsEngine>)

  vi.mocked(useIsMobile).mockReturnValue(overrides.isMobile ?? false)

  if (overrides.flatFiles) {
    vi.mocked(flattenFiles).mockReturnValue(
      overrides.flatFiles as ReturnType<typeof flattenFiles>,
    )
  }

  return { mockStop, mockHandleGenerate, mockHandleRegenerate, mockHandleDeleteDoc }
}

/** Helper: produce a saved doc for tests that need an existing document visible */
function makeSavedDoc(overrides: Partial<{ id: string; type: string; title: string; messages: ReturnType<typeof makeAssistantMessage>[]; createdAt: Date; targetFile: string; customPrompt: string }> = {}) {
  return {
    id: 'doc-1',
    type: 'architecture',
    title: 'Architecture Overview',
    messages: [makeAssistantMessage('# Doc Content')],
    createdAt: new Date(),
    ...overrides,
  }
}

// ---------- Tests ----------

describe('DocViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================================================
  // 1. Cancel Button
  // ================================================================
  describe('Cancel Button', () => {
    it('shows Stop button when status is streaming and messages exist', () => {
      setupMocks({
        status: 'streaming',
        messages: [makeAssistantMessage('Generating...')],
      })
      render(<DocViewer />)
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
    })

    it('hides Stop button when status is ready', () => {
      setupMocks({ status: 'ready' })
      render(<DocViewer />)
      expect(
        screen.queryByRole('button', { name: /stop/i }),
      ).not.toBeInTheDocument()
    })

    it('calls stop() on click', async () => {
      const user = userEvent.setup()
      const { mockStop } = setupMocks({
        status: 'streaming',
        messages: [makeAssistantMessage('Generating...')],
      })
      render(<DocViewer />)
      await user.click(screen.getByRole('button', { name: /stop/i }))
      expect(mockStop).toHaveBeenCalledOnce()
    })
  })

  // ================================================================
  // 2. Error Handling
  // ================================================================
  describe('Error Handling', () => {
    it('shows error banner with message when error is set', () => {
      setupMocks({ error: new Error('API rate limit exceeded') })
      render(<DocViewer />)
      expect(screen.getByText('API rate limit exceeded')).toBeInTheDocument()
    })

    it('shows Try Again button in error banner', () => {
      setupMocks({ error: new Error('Oops') })
      render(<DocViewer />)
      expect(
        screen.getByRole('button', { name: /try again/i }),
      ).toBeInTheDocument()
    })

    it('hides error banner when error is null', () => {
      setupMocks({ error: null })
      render(<DocViewer />)
      expect(screen.queryByText(/try again/i)).not.toBeInTheDocument()
    })

    it('hides error banner while generating', () => {
      setupMocks({
        error: new Error('Previous error'),
        status: 'streaming',
        messages: [makeAssistantMessage('text')],
      })
      render(<DocViewer />)
      expect(screen.queryByText('Previous error')).not.toBeInTheDocument()
    })
  })

  // ================================================================
  // 3. Progress Protection
  // ================================================================
  describe('Progress Protection', () => {
    it('disables New button during generation', () => {
      setupMocks({
        status: 'streaming',
        messages: [makeAssistantMessage('Working...')],
      })
      render(<DocViewer />)
      const newBtn = screen.getByRole('button', { name: /new/i })
      expect(newBtn).toBeDisabled()
    })

    it('enables New button when not generating', () => {
      setupMocks({ status: 'ready' })
      render(<DocViewer />)
      const newBtn = screen.getByRole('button', { name: /new/i })
      expect(newBtn).toBeEnabled()
    })
  })

  // ================================================================
  // 4. Delete Confirmation
  // ================================================================
  describe('Delete Confirmation', () => {
    function renderWithDoc() {
      const doc = makeSavedDoc()
      const mocks = setupMocks({
        generatedDocs: [doc],
        activeDocId: 'doc-1',
        showNewDoc: false,
      })
      render(<DocViewer />)
      return { mocks }
    }

    it('opens AlertDialog when delete icon is clicked', async () => {
      const user = userEvent.setup()
      renderWithDoc()

      // There should be a doc row in the sidebar with a delete trigger
      const docRow = document.querySelector('[role="button"]')
      expect(docRow).not.toBeNull()

      // The delete button is a <button> inside the doc row (AlertDialogTrigger)
      const innerButton = docRow!.querySelector('button')
      expect(innerButton).not.toBeNull()

      await user.click(innerButton!)
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(screen.getByText('Delete this document?')).toBeInTheDocument()
    })

    it('does NOT delete doc when Cancel is clicked', async () => {
      const user = userEvent.setup()
      renderWithDoc()

      const docRow = document.querySelector('[role="button"]')
      const innerButton = docRow!.querySelector('button')
      await user.click(innerButton!)

      await user.click(screen.getByRole('button', { name: /cancel/i }))
      // Doc row should still exist
      expect(document.querySelector('[role="button"]')).not.toBeNull()
    })

    it('calls handleDeleteDoc when Delete is confirmed', async () => {
      const user = userEvent.setup()
      const { mocks } = renderWithDoc()

      const docRow = document.querySelector('[role="button"]')
      const innerButton = docRow!.querySelector('button')
      await user.click(innerButton!)

      // Click the destructive "Delete" action
      const deleteBtn = screen.getByRole('button', { name: /^delete$/i })
      await user.click(deleteBtn)

      expect(mocks.mockHandleDeleteDoc).toHaveBeenCalledWith('doc-1')
    })
  })

  // ================================================================
  // 5. Model Indicator
  // ================================================================
  describe('Model Indicator', () => {
    it('displays selected model name on generate screen', () => {
      setupMocks()
      render(<DocViewer />)
      expect(screen.getByText(/using gpt-4/i)).toBeInTheDocument()
    })

    it('updates when selectedModel changes', () => {
      setupMocks({
        selectedModel: {
          id: 'claude-3',
          name: 'Claude 4.6 Opus',
          provider: 'anthropic',
        } as unknown as typeof defaultAPIKeysValue.selectedModel,
      })
      render(<DocViewer />)
      expect(screen.getByText(/using claude 4\.6 opus/i)).toBeInTheDocument()
    })
  })

  // ================================================================
  // 6. Mobile Responsive
  // ================================================================
  describe('Mobile Responsive', () => {
    it('hides static sidebar on mobile', () => {
      setupMocks({ isMobile: true })
      render(<DocViewer />)
      expect(document.querySelector('.w-56')).toBeNull()
    })

    it('shows sidebar on desktop', () => {
      setupMocks({ isMobile: false })
      render(<DocViewer />)
      expect(document.querySelector('.w-56')).not.toBeNull()
    })
  })

  // ================================================================
  // 7. File Picker
  // ================================================================
  describe('File Picker', () => {
    it('shows "Showing X of Y files" label', async () => {
      const user = userEvent.setup()
      setupMocks({ flatFiles: createFileList(100) })
      render(<DocViewer />)
      await user.click(screen.getByText('Explain a File'))
      expect(screen.getByText(/showing 50 of 100 files/i)).toBeInTheDocument()
    })

    it('limits displayed files to 50', async () => {
      const user = userEvent.setup()
      setupMocks({ flatFiles: createFileList(80) })
      render(<DocViewer />)
      await user.click(screen.getByText('Explain a File'))
      const fileButtons = screen.getAllByText(/^src\/file-\d+\.ts$/)
      expect(fileButtons.length).toBe(50)
    })

    it('shows truncation hint at limit', async () => {
      const user = userEvent.setup()
      setupMocks({ flatFiles: createFileList(100) })
      render(<DocViewer />)
      await user.click(screen.getByText('Explain a File'))
      expect(
        screen.getByText(/type to search for more files/i),
      ).toBeInTheDocument()
    })

    it('hides truncation hint when all files fit', async () => {
      const user = userEvent.setup()
      setupMocks({ flatFiles: createFileList(10) })
      render(<DocViewer />)
      await user.click(screen.getByText('Explain a File'))
      expect(
        screen.queryByText(/type to search for more files/i),
      ).not.toBeInTheDocument()
    })
  })

  // ================================================================
  // 8. Copy to Clipboard
  // ================================================================
  describe('Copy to Clipboard', () => {
    it('copies doc text via navigator.clipboard.writeText', async () => {
      const user = userEvent.setup()
      const writeTextMock = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      })

      const doc = makeSavedDoc({ messages: [makeAssistantMessage('# Hello World')] })
      setupMocks({
        generatedDocs: [doc],
        activeDocId: 'doc-1',
        showNewDoc: false,
      })
      render(<DocViewer />)

      await user.click(screen.getByTitle('Copy to clipboard'))
      expect(writeTextMock).toHaveBeenCalledWith('# Hello World')
    })
  })

  // ================================================================
  // 9. Tool Activity Expansion
  // ================================================================
  describe('Tool Activity Expansion', () => {
    function setupToolActivity() {
      const toolCalls = Array.from({ length: 8 }, (_, i) => ({
        name: 'readFile',
        path: `src/components/file-${i}.tsx`,
        state: 'output-available',
      }))
      vi.mocked(isToolUIPart).mockImplementation((part: unknown) => {
        return (part as { type?: string })?.type === 'tool-invocation'
      })
      vi.mocked(getToolName).mockImplementation((part: unknown) => {
        return (part as { toolName?: string })?.toolName || ''
      })
      const toolMsg = makeToolMessage(toolCalls)
      const textMsg = makeAssistantMessage('Writing...')
      setupMocks({
        status: 'streaming',
        messages: [toolMsg, textMsg] as ReturnType<typeof makeAssistantMessage>[],
      })
    }

    it('shows only last 5 file badges by default', () => {
      setupToolActivity()
      render(<DocViewer />)
      expect(screen.getByText('Read 8 files')).toBeInTheDocument()
      expect(screen.getByText('Show all 8')).toBeInTheDocument()
      expect(screen.getAllByText(/file-\d+\.tsx/).length).toBe(5)
    })

    it('expands all when Show all is clicked', async () => {
      const user = userEvent.setup()
      setupToolActivity()
      render(<DocViewer />)
      await user.click(screen.getByText('Show all 8'))
      expect(screen.getAllByText(/file-\d+\.tsx/).length).toBe(8)
      expect(screen.getByText('Show less')).toBeInTheDocument()
    })

    it('collapses back when Show less is clicked', async () => {
      const user = userEvent.setup()
      setupToolActivity()
      render(<DocViewer />)
      await user.click(screen.getByText('Show all 8'))
      await user.click(screen.getByText('Show less'))
      expect(screen.getAllByText(/file-\d+\.tsx/).length).toBe(5)
    })
  })

  // ================================================================
  // 10. Regenerate
  // ================================================================
  describe('Regenerate', () => {
    it('shows Regenerate button on completed doc view', () => {
      const doc = makeSavedDoc()
      setupMocks({
        generatedDocs: [doc],
        activeDocId: 'doc-1',
        showNewDoc: false,
      })
      render(<DocViewer />)
      expect(screen.getByTitle('Regenerate')).toBeInTheDocument()
    })

    it('calls handleRegenerate when clicked', async () => {
      const user = userEvent.setup()
      const doc = makeSavedDoc()
      const mocks = setupMocks({
        generatedDocs: [doc],
        activeDocId: 'doc-1',
        showNewDoc: false,
      })
      render(<DocViewer />)

      await user.click(screen.getByTitle('Regenerate'))
      expect(mocks.mockHandleRegenerate).toHaveBeenCalledWith(doc)
    })
  })

  // ================================================================
  // 11. Auto-Scroll
  // ================================================================
  describe('Auto-Scroll', () => {
    it('renders streaming content with ref attached', () => {
      setupMocks({
        status: 'streaming',
        messages: [makeAssistantMessage('Streaming...')],
      })
      render(<DocViewer />)
      expect(screen.getByText('Streaming...')).toBeInTheDocument()
    })
  })

  // ================================================================
  // 12. Persistent New Button
  // ================================================================
  describe('Persistent New Button', () => {
    it('shows New text in sidebar', () => {
      setupMocks()
      render(<DocViewer />)
      expect(screen.getByText('New')).toBeInTheDocument()
    })

    it('is always visible and enabled', () => {
      setupMocks()
      render(<DocViewer />)
      const btn = screen.getByRole('button', { name: /new/i })
      expect(btn).toBeEnabled()
    })
  })

  // ================================================================
  // Edge Cases
  // ================================================================
  describe('Edge: No Repo', () => {
    it('shows connect repository message', () => {
      setupMocks({ repo: null, files: [] })
      render(<DocViewer />)
      expect(screen.getByText(/connect a github repository/i)).toBeInTheDocument()
    })
  })

  describe('Edge: No API Key', () => {
    it('shows API key required message', () => {
      setupMocks({ getValidProviders: () => [], selectedModel: null })
      render(<DocViewer />)
      expect(screen.getByText(/api key required/i)).toBeInTheDocument()
    })
  })

  describe('Doc Presets', () => {
    it('renders all 5 preset buttons', () => {
      setupMocks()
      render(<DocViewer />)
      expect(screen.getByText('Architecture Overview')).toBeInTheDocument()
      expect(screen.getByText('Setup / Getting Started')).toBeInTheDocument()
      expect(screen.getByText('API Reference')).toBeInTheDocument()
      expect(screen.getByText('Explain a File')).toBeInTheDocument()
      expect(screen.getByText('Custom Prompt')).toBeInTheDocument()
    })
  })
})
