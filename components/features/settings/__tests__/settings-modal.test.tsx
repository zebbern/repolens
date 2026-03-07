import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the APIKeys provider
vi.mock('@/providers/api-keys-provider', () => ({
  useAPIKeys: () => ({
    apiKeys: {
      openai: { key: 'sk-test', isValid: true },
      google: { key: '', isValid: null },
      anthropic: { key: '', isValid: null },
      openrouter: { key: '', isValid: null },
    },
    models: [],
    setAPIKey: vi.fn(),
    validateAPIKey: vi.fn(),
    removeAPIKey: vi.fn(),
  }),
  PROVIDERS: {
    openai: { id: 'openai', name: 'OpenAI', description: 'GPT-5.4', docsUrl: 'https://platform.openai.com/api-keys', keyPrefix: 'sk-' },
    google: { id: 'google', name: 'Google', description: 'Gemini Pro', docsUrl: 'https://aistudio.google.com/apikey', keyPrefix: 'AI' },
    anthropic: { id: 'anthropic', name: 'Anthropic', description: 'Claude 4.6 Sonnet, Claude 4.6 Opus', docsUrl: 'https://console.anthropic.com/settings/keys', keyPrefix: 'sk-ant-' },
    openrouter: { id: 'openrouter', name: 'OpenRouter', description: 'Multiple providers', docsUrl: 'https://openrouter.ai/keys', keyPrefix: 'sk-or-' },
  },
}))

// Mock the GitHub token provider
vi.mock('@/providers/github-token-provider', () => ({
  useGitHubToken: () => ({
    token: null,
    isValid: null,
    isValidating: false,
    isHydrated: true,
    username: null,
    scopes: [],
    setToken: vi.fn(),
    validateToken: vi.fn(),
    removeToken: vi.fn(),
  }),
}))

// Mock the APIKeyInput component to isolate SettingsModal tests
vi.mock('../api-key-input', () => ({
  APIKeyInput: ({ provider }: { provider: string }) => (
    <div data-testid={`api-key-input-${provider}`}>API Key Input for {provider}</div>
  ),
}))

// Mock the GitHubTokenInput component
vi.mock('../github-token-input', () => ({
  GitHubTokenInput: () => (
    <div data-testid="github-token-input">GitHub Token Input</div>
  ),
}))

import { SettingsModal } from '../settings-modal'

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog with title when open', () => {
    render(<SettingsModal open={true} onOpenChange={vi.fn()} />)
    expect(screen.getByText('API Settings')).toBeInTheDocument()
  })

  it('does not render content when closed', () => {
    render(<SettingsModal open={false} onOpenChange={vi.fn()} />)
    expect(screen.queryByText('API Settings')).not.toBeInTheDocument()
  })

  it('renders tabs for all four providers and GitHub', () => {
    render(<SettingsModal open={true} onOpenChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /github/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /openai/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /google/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /anthropic/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /openrouter/i })).toBeInTheDocument()
  })

  it('renders GitHubTokenInput for the default active tab', () => {
    render(<SettingsModal open={true} onOpenChange={vi.fn()} />)
    // Default active tab is "github"
    expect(screen.getByTestId('github-token-input')).toBeInTheDocument()
  })

  it('switches to another provider tab on click', async () => {
    const user = userEvent.setup()
    render(<SettingsModal open={true} onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: /google/i }))
    expect(screen.getByTestId('api-key-input-google')).toBeInTheDocument()
  })

  it('shows green dot indicator for validated providers', () => {
    render(<SettingsModal open={true} onOpenChange={vi.fn()} />)
    // OpenAI has isValid=true, should have the green dot
    const openaiTab = screen.getByRole('tab', { name: /openai/i })
    const dot = openaiTab.querySelector('.bg-status-success')
    expect(dot).toBeInTheDocument()
  })

  it('calls onOpenChange when dialog is closed', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<SettingsModal open={true} onOpenChange={onOpenChange} />)

    // Press Escape to close
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
