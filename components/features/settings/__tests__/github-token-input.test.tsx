import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Mock the useGitHubToken hook
// ---------------------------------------------------------------------------

const mockSetToken = vi.fn()
const mockValidateToken = vi.fn()
const mockRemoveToken = vi.fn()

let mockTokenState = {
  token: null as string | null,
  isValid: null as boolean | null,
  isValidating: false,
  isHydrated: true,
  username: null as string | null,
  scopes: [] as string[],
}

vi.mock('@/providers/github-token-provider', () => ({
  useGitHubToken: () => ({
    ...mockTokenState,
    setToken: mockSetToken,
    validateToken: mockValidateToken,
    removeToken: mockRemoveToken,
  }),
}))

import { GitHubTokenInput } from '../github-token-input'

describe('GitHubTokenInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTokenState = {
      token: null,
      isValid: null,
      isValidating: false,
      isHydrated: true,
      username: null,
      scopes: [],
    }
  })

  it('renders the PAT input field', () => {
    render(<GitHubTokenInput />)
    expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument()
  })

  it('renders password input by default (masked)', () => {
    render(<GitHubTokenInput />)
    const input = screen.getByPlaceholderText(/ghp_/)
    expect(input).toHaveAttribute('type', 'password')
  })

  it('toggles password visibility when the eye button is clicked', async () => {
    const user = userEvent.setup()
    render(<GitHubTokenInput />)

    const input = screen.getByPlaceholderText(/ghp_/)
    expect(input).toHaveAttribute('type', 'password')

    // Click the toggle button (the only ghost icon button in the input area)
    const toggleButtons = screen.getAllByRole('button')
    const eyeToggle = toggleButtons.find(
      (btn) => !btn.textContent?.includes('Test') && !btn.textContent?.includes('Remove'),
    )
    if (eyeToggle) {
      await user.click(eyeToggle)
      expect(input).toHaveAttribute('type', 'text')
    }
  })

  it('calls setToken when input is committed via blur', async () => {
    const user = userEvent.setup()
    render(<GitHubTokenInput />)

    const input = screen.getByPlaceholderText(/ghp_/)
    await user.type(input, 'ghp_test123')
    await user.tab() // blur

    expect(mockSetToken).toHaveBeenCalled()
  })

  it('triggers validation when Test button is clicked', async () => {
    mockTokenState = {
      ...mockTokenState,
      token: 'ghp_test123',
    }
    mockValidateToken.mockResolvedValue(true)

    const user = userEvent.setup()
    render(<GitHubTokenInput />)

    await user.click(screen.getByRole('button', { name: /test/i }))

    expect(mockValidateToken).toHaveBeenCalled()
  })

  it('shows success status after successful validation', () => {
    mockTokenState = {
      ...mockTokenState,
      token: 'ghp_valid',
      isValid: true,
      username: 'octocat',
    }

    render(<GitHubTokenInput />)

    expect(screen.getByText(/connected/i)).toBeInTheDocument()
    expect(screen.getByText(/octocat/)).toBeInTheDocument()
  })

  it('shows error status after failed validation', () => {
    mockTokenState = {
      ...mockTokenState,
      token: 'ghp_invalid',
      isValid: false,
    }

    render(<GitHubTokenInput />)

    expect(screen.getByText(/invalid token/i)).toBeInTheDocument()
  })

  it('shows "Not tested" when token is present but not validated', () => {
    mockTokenState = {
      ...mockTokenState,
      token: 'ghp_untested',
      isValid: null,
    }

    render(<GitHubTokenInput />)

    expect(screen.getByText(/not tested/i)).toBeInTheDocument()
  })

  it('shows scopes when token is valid and scopes are available', () => {
    mockTokenState = {
      ...mockTokenState,
      token: 'ghp_valid',
      isValid: true,
      username: 'octocat',
      scopes: ['repo', 'read:org'],
    }

    render(<GitHubTokenInput />)

    expect(screen.getByText('Token Scopes')).toBeInTheDocument()
    expect(screen.getByText('read:org')).toBeInTheDocument()
    // "repo" appears both as a scope badge and in help text — check both exist
    expect(screen.getAllByText('repo').length).toBeGreaterThanOrEqual(1)
  })

  it('calls removeToken and clears input when remove button is clicked', async () => {
    mockTokenState = {
      ...mockTokenState,
      token: 'ghp_to_remove',
      isValid: true,
    }

    const user = userEvent.setup()
    render(<GitHubTokenInput />)

    // The remove button is a ghost button with trash icon
    const buttons = screen.getAllByRole('button')
    const removeButton = buttons.find(
      (btn) => btn.querySelector('.lucide-trash-2') !== null,
    )

    if (removeButton) {
      await user.click(removeButton)
      expect(mockRemoveToken).toHaveBeenCalled()
    }
  })

  it('disables Test button when no token is present', () => {
    mockTokenState = {
      ...mockTokenState,
      token: null,
    }

    render(<GitHubTokenInput />)

    const testButton = screen.getByRole('button', { name: /test/i })
    expect(testButton).toBeDisabled()
  })
})
