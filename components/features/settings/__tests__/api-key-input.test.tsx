import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the APIKeys provider
const mockSetAPIKey = vi.fn()
const mockValidateAPIKey = vi.fn().mockResolvedValue(undefined)
const mockRemoveAPIKey = vi.fn()

vi.mock('@/providers/api-keys-provider', () => ({
  useAPIKeys: () => ({
    apiKeys: {
      openai: { key: '', isValid: null },
      google: { key: '', isValid: null },
      anthropic: { key: 'sk-ant-test-key', isValid: true },
      openrouter: { key: 'sk-or-invalid', isValid: false },
    },
    models: [
      { id: 'claude-3-opus', name: 'Claude 4.6 Opus', provider: 'anthropic', contextLength: 200000 },
      { id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic', contextLength: 200000 },
    ],
    setAPIKey: mockSetAPIKey,
    validateAPIKey: mockValidateAPIKey,
    removeAPIKey: mockRemoveAPIKey,
  }),
  PROVIDERS: {
    openai: { id: 'openai', name: 'OpenAI', description: 'GPT-5.4', docsUrl: 'https://platform.openai.com/api-keys', keyPrefix: 'sk-' },
    google: { id: 'google', name: 'Google', description: 'Gemini Pro', docsUrl: 'https://aistudio.google.com/apikey', keyPrefix: 'AI' },
    anthropic: { id: 'anthropic', name: 'Anthropic', description: 'Claude 4.6 Sonnet, Claude 4.6 Opus', docsUrl: 'https://console.anthropic.com/settings/keys', keyPrefix: 'sk-ant-' },
    openrouter: { id: 'openrouter', name: 'OpenRouter', description: 'Multiple providers', docsUrl: 'https://openrouter.ai/keys', keyPrefix: 'sk-or-' },
  },
}))

import { APIKeyInput } from '../api-key-input'

describe('APIKeyInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the API Key label', () => {
    render(<APIKeyInput provider="openai" />)
    expect(screen.getByText('API Key')).toBeInTheDocument()
  })

  it('renders the "Get API key" link pointing to docs URL', () => {
    render(<APIKeyInput provider="openai" />)
    const link = screen.getByText('Get API key')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', 'https://platform.openai.com/api-keys')
  })

  it('renders the input field with correct placeholder', () => {
    render(<APIKeyInput provider="openai" />)
    expect(screen.getByPlaceholderText('Enter your OpenAI API key')).toBeInTheDocument()
  })

  it('renders "Test" button', () => {
    render(<APIKeyInput provider="openai" />)
    expect(screen.getByRole('button', { name: /test/i })).toBeInTheDocument()
  })

  it('disables Test button when no key is entered', () => {
    render(<APIKeyInput provider="openai" />)
    expect(screen.getByRole('button', { name: /test/i })).toBeDisabled()
  })

  it('renders "Connected" status for valid key', () => {
    render(<APIKeyInput provider="anthropic" />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('renders "Invalid key" status for invalid key', () => {
    render(<APIKeyInput provider="openrouter" />)
    expect(screen.getByText('Invalid key')).toBeInTheDocument()
  })

  it('renders available models when key is valid', () => {
    render(<APIKeyInput provider="anthropic" />)
    expect(screen.getByText('Available Models')).toBeInTheDocument()
    expect(screen.getByText('Claude 4.6 Opus')).toBeInTheDocument()
    expect(screen.getByText('Claude 3 Haiku')).toBeInTheDocument()
  })

  it('renders provider description', () => {
    render(<APIKeyInput provider="anthropic" />)
    expect(screen.getByText('Claude 4.6 Sonnet, Claude 4.6 Opus')).toBeInTheDocument()
  })

  it('calls removeAPIKey when trash button is clicked', async () => {
    const user = userEvent.setup()
    render(<APIKeyInput provider="anthropic" />)

    // Find the trash/remove button
    const removeBtn = screen.getAllByRole('button').find(
      btn => !btn.textContent?.includes('Test')
    )
    // The trash button is among the buttons — click the last non-Test, non-eye button
    const buttons = screen.getAllByRole('button')
    const trashBtn = buttons[buttons.length - 1]
    await user.click(trashBtn)

    expect(mockRemoveAPIKey).toHaveBeenCalledWith('anthropic')
  })
})
