import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Mock next-auth/react
// ---------------------------------------------------------------------------

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))

import { signIn } from 'next-auth/react'

import {
  AuthorAvatar,
  CommitMessage,
  DiffStats,
  FileStatusBadge,
  RelativeDate,
  LoginRequiredNotice,
} from '../git-history-helpers'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthorAvatar', () => {
  it('renders an image when avatarUrl is provided', () => {
    render(<AuthorAvatar login="alice" avatarUrl="https://avatar.test/alice" name="Alice Smith" />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://avatar.test/alice')
    expect(img).toHaveAttribute('alt', "Alice Smith's avatar")
  })

  it('renders initials when no avatarUrl', () => {
    render(<AuthorAvatar login={null} avatarUrl={null} name="Alice Smith" />)

    expect(screen.getByText('AS')).toBeInTheDocument()
  })
})

describe('CommitMessage', () => {
  it('renders the first line of the message', () => {
    render(<CommitMessage message={'fix: bug\n\nDetailed description'} />)

    expect(screen.getByText('fix: bug')).toBeInTheDocument()
  })

  it('truncates messages longer than maxLength', () => {
    const longMessage = 'A'.repeat(100)
    render(<CommitMessage message={longMessage} maxLength={10} />)

    // Should show truncated text with ellipsis
    expect(screen.getByText('AAAAAAAAAA…')).toBeInTheDocument()
  })
})

describe('DiffStats', () => {
  it('shows additions and deletions', () => {
    render(<DiffStats additions={10} deletions={5} />)

    expect(screen.getByText('+10')).toBeInTheDocument()
    expect(screen.getByText('-5')).toBeInTheDocument()
  })

  it('hides zero additions', () => {
    const { container } = render(<DiffStats additions={0} deletions={3} />)

    expect(container.textContent).not.toContain('+0')
    expect(screen.getByText('-3')).toBeInTheDocument()
  })
})

describe('FileStatusBadge', () => {
  it.each([
    { status: 'added', label: 'A' },
    { status: 'removed', label: 'D' },
    { status: 'modified', label: 'M' },
    { status: 'renamed', label: 'R' },
  ])('renders "$label" for status "$status"', ({ status, label }) => {
    render(<FileStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

describe('RelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
  })

  it('formats a recent date as relative', () => {
    // 30 seconds ago
    render(<RelativeDate date="2024-06-15T11:59:30Z" />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('formats an old date with unit', () => {
    // 3 days ago
    render(<RelativeDate date="2024-06-12T12:00:00Z" />)
    expect(screen.getByText('3d ago')).toBeInTheDocument()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

describe('LoginRequiredNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a sign-in prompt', () => {
    render(<LoginRequiredNotice />)

    expect(screen.getByText('Login to view blame data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('calls signIn on button click', async () => {
    render(<LoginRequiredNotice />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(signIn).toHaveBeenCalledWith('github')
  })
})
