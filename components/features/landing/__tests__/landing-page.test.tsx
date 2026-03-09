import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock providers
vi.mock('@/providers', () => ({
  useRepository: () => ({
    loadingStage: 'idle',
    indexingProgress: 0,
    isCacheHit: false,
  }),
  useRepositoryData: () => ({
    isCacheHit: false,
  }),
  useRepositoryProgress: () => ({
    loadingStage: 'idle',
    indexingProgress: 0,
  }),
}))

vi.mock('@/components/features/loading/loading-progress', () => ({
  LoadingProgress: () => <div data-testid="loading-progress">loading</div>,
}))

import { LandingPage } from '../landing-page'

const defaultProps = {
  repoUrl: '',
  onRepoUrlChange: vi.fn(),
  onConnect: vi.fn(),
  onConnectWithUrl: vi.fn(),
  isConnecting: false,
  error: null,
}

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the hero headline', () => {
    render(<LandingPage {...defaultProps} />)
    expect(screen.getByText(/understand any github/i)).toBeInTheDocument()
    expect(screen.getByText(/repository in seconds/i)).toBeInTheDocument()
  })

  it('renders the repo URL input', () => {
    render(<LandingPage {...defaultProps} />)
    expect(
      screen.getByPlaceholderText('https://github.com/username/repo')
    ).toBeInTheDocument()
  })

  it('renders the Connect Repository button', () => {
    render(<LandingPage {...defaultProps} />)
    expect(screen.getByText('Connect Repository')).toBeInTheDocument()
  })

  it('disables Connect button when input is empty', () => {
    render(<LandingPage {...defaultProps} repoUrl="" />)
    expect(screen.getByText('Connect Repository').closest('button')).toBeDisabled()
  })

  it('enables Connect button when URL is provided', () => {
    render(<LandingPage {...defaultProps} repoUrl="https://github.com/owner/repo" />)
    expect(screen.getByText('Connect Repository').closest('button')).toBeEnabled()
  })

  it('disables the button and shows "Connecting..." while isConnecting', () => {
    render(<LandingPage {...defaultProps} repoUrl="https://github.com/owner/repo" isConnecting={true} />)
    expect(screen.getByText(/connecting/i)).toBeInTheDocument()
    expect(screen.getByText(/connecting/i).closest('button')).toBeDisabled()
  })

  it('displays error message when error prop is set', () => {
    render(<LandingPage {...defaultProps} error="Repository not found" />)
    expect(screen.getByText('Repository not found')).toBeInTheDocument()
  })

  it('renders example repo buttons', () => {
    render(<LandingPage {...defaultProps} />)
    expect(screen.getByText('pmndrs/zustand')).toBeInTheDocument()
    expect(screen.getByText('shadcn-ui/ui')).toBeInTheDocument()
    expect(screen.getByText('t3-oss/create-t3-app')).toBeInTheDocument()
    expect(screen.getByText('tailwindlabs/heroicons')).toBeInTheDocument()
  })

  it('calls onRepoUrlChange when typing in the input', async () => {
    const user = userEvent.setup()
    const onRepoUrlChange = vi.fn()
    render(<LandingPage {...defaultProps} onRepoUrlChange={onRepoUrlChange} />)

    const input = screen.getByPlaceholderText('https://github.com/username/repo')
    await user.type(input, 'a')

    expect(onRepoUrlChange).toHaveBeenCalled()
  })

  it('calls onConnect when Connect Repository button is clicked', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(<LandingPage {...defaultProps} repoUrl="https://github.com/test/repo" onConnect={onConnect} />)

    await user.click(screen.getByText('Connect Repository'))
    expect(onConnect).toHaveBeenCalled()
  })

  it('calls onConnectWithUrl when example repo is clicked', async () => {
    const user = userEvent.setup()
    const onRepoUrlChange = vi.fn()
    const onConnectWithUrl = vi.fn()
    render(
      <LandingPage
        {...defaultProps}
        onRepoUrlChange={onRepoUrlChange}
        onConnectWithUrl={onConnectWithUrl}
      />
    )

    await user.click(screen.getByText('pmndrs/zustand'))
    expect(onRepoUrlChange).toHaveBeenCalledWith('https://github.com/pmndrs/zustand')
    expect(onConnectWithUrl).toHaveBeenCalledWith('https://github.com/pmndrs/zustand')
  })

  it('calls onConnect when Enter is pressed in the input', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(<LandingPage {...defaultProps} repoUrl="https://github.com/owner/repo" onConnect={onConnect} />)

    const input = screen.getByPlaceholderText('https://github.com/username/repo')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onConnect).toHaveBeenCalled()
  })

  it('shows the tip about "m" prefix for quick access', () => {
    render(<LandingPage {...defaultProps} />)
    expect(screen.getByText(/mgithub\.com\/owner\/repo/i)).toBeInTheDocument()
  })

  it('shows loading progress when connecting', () => {
    render(<LandingPage {...defaultProps} isConnecting={true} repoUrl="https://github.com/owner/repo" />)
    expect(screen.getByTestId('loading-progress')).toBeInTheDocument()
  })

  it('disables example repo buttons while connecting', () => {
    render(<LandingPage {...defaultProps} isConnecting={true} repoUrl="test" />)
    const zustandBtn = screen.getByText('pmndrs/zustand')
    expect(zustandBtn.closest('button')).toBeDisabled()
  })
})
