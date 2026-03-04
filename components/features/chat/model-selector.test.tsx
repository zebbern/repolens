import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from './model-selector'
import type { ProviderModel, AIProvider } from '@/types/types'

// Mock data
const mockModels: ProviderModel[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google' },
]

const mockSetSelectedModel = vi.fn()
const mockGetValidProviders = vi.fn<() => AIProvider[]>()

// Mock the useAPIKeys hook
vi.mock('@/providers', () => ({
  useAPIKeys: () => ({
    models: mockModels,
    selectedModel: null as ProviderModel | null,
    setSelectedModel: mockSetSelectedModel,
    getValidProviders: mockGetValidProviders,
    modelFetchErrors: {} as Record<string, string>,
  }),
}))

// Mock the PROVIDERS constant
vi.mock('@/providers/api-keys-provider', () => ({
  PROVIDERS: {
    openai: { id: 'openai', name: 'OpenAI', description: '', docsUrl: '', keyPrefix: 'sk-' },
    google: { id: 'google', name: 'Google', description: '', docsUrl: '', keyPrefix: 'AI' },
    anthropic: { id: 'anthropic', name: 'Anthropic', description: '', docsUrl: '', keyPrefix: 'sk-ant-' },
    openrouter: { id: 'openrouter', name: 'OpenRouter', description: '', docsUrl: '', keyPrefix: 'sk-or-' },
  },
}))

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetValidProviders.mockReturnValue(['openai', 'google'])
  })

  it('renders the trigger button with "Select model" when no model is selected', () => {
    render(<ModelSelector />)

    expect(screen.getByRole('button', { name: /select model/i })).toBeInTheDocument()
  })

  it('opens dropdown menu on click', async () => {
    const user = userEvent.setup()
    render(<ModelSelector />)

    const trigger = screen.getByRole('button', { name: /select model/i })
    await user.click(trigger)

    // Provider labels should appear
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Google')).toBeInTheDocument()
  })

  it('displays models grouped by provider', async () => {
    const user = userEvent.setup()
    render(<ModelSelector />)

    await user.click(screen.getByRole('button', { name: /select model/i }))

    // Models should be visible
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.getByText('GPT-3.5 Turbo')).toBeInTheDocument()
    expect(screen.getByText('Gemini 1.5 Pro')).toBeInTheDocument()
  })

  it('calls setSelectedModel when a model is clicked', async () => {
    const user = userEvent.setup()
    render(<ModelSelector />)

    await user.click(screen.getByRole('button', { name: /select model/i }))
    await user.click(screen.getByText('GPT-4o'))

    expect(mockSetSelectedModel).toHaveBeenCalledWith(mockModels[0])
  })

  it('displays default "Select model" text when no model is selected', () => {
    render(<ModelSelector />)
    expect(screen.getByRole('button', { name: /select model/i })).toBeInTheDocument()
  })
})
