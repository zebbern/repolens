import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatInput } from './chat-input'

// Mock the ModelSelector since it depends on APIKeysProvider context
vi.mock('./model-selector', () => ({
  ModelSelector: () => <button data-testid="model-selector">Select model</button>,
}))

describe('ChatInput', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with default placeholder text', () => {
    render(<ChatInput {...defaultProps} />)

    expect(screen.getByPlaceholderText('Ask about the codebase...')).toBeInTheDocument()
  })

  it('renders with custom placeholder text', () => {
    render(<ChatInput {...defaultProps} placeholder="Custom placeholder" />)

    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument()
  })

  it('displays the current value in the textarea', () => {
    render(<ChatInput {...defaultProps} value="Hello world" />)

    expect(screen.getByDisplayValue('Hello world')).toBeInTheDocument()
  })

  it('calls onChange when user types in the textarea', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ChatInput {...defaultProps} onChange={onChange} />)

    const textarea = screen.getByPlaceholderText('Ask about the codebase...')
    await user.type(textarea, 'x')

    expect(onChange).toHaveBeenCalledWith('x')
  })

  it('calls onSubmit when the form is submitted via submit button', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ChatInput {...defaultProps} value="test message" onSubmit={onSubmit} />)

    const buttons = screen.getAllByRole('button')
    const submitBtn = buttons.find(btn => btn.getAttribute('type') === 'submit')!
    await user.click(submitBtn)

    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('submits on Enter key (without Shift)', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ChatInput {...defaultProps} value="test" onSubmit={onSubmit} />)

    const textarea = screen.getByPlaceholderText('Ask about the codebase...')
    await user.click(textarea)
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('does NOT submit on Shift+Enter (allows newline)', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ChatInput {...defaultProps} value="test" onSubmit={onSubmit} />)

    const textarea = screen.getByPlaceholderText('Ask about the codebase...')
    await user.click(textarea)
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables the submit button when value is empty', () => {
    render(<ChatInput {...defaultProps} value="" />)

    const buttons = screen.getAllByRole('button')
    const submitBtn = buttons.find(btn => btn.getAttribute('type') === 'submit')!
    expect(submitBtn).toBeDisabled()
  })

  it('disables the submit button when value is only whitespace', () => {
    render(<ChatInput {...defaultProps} value="   " />)

    const buttons = screen.getAllByRole('button')
    const submitBtn = buttons.find(btn => btn.getAttribute('type') === 'submit')!
    expect(submitBtn).toBeDisabled()
  })

  it('enables the submit button when value has content', () => {
    render(<ChatInput {...defaultProps} value="hello" />)

    const buttons = screen.getAllByRole('button')
    const submitBtn = buttons.find(btn => btn.getAttribute('type') === 'submit')!
    expect(submitBtn).not.toBeDisabled()
  })

  it('disables all inputs when isLoading is true', () => {
    render(<ChatInput {...defaultProps} value="hello" isLoading={true} />)

    const textarea = screen.getByPlaceholderText('Ask about the codebase...')
    expect(textarea).toBeDisabled()

    const buttons = screen.getAllByRole('button')
    const submitBtn = buttons.find(btn => btn.getAttribute('type') === 'submit')!
    expect(submitBtn).toBeDisabled()
  })

  it('disables all inputs when disabled prop is true', () => {
    render(<ChatInput {...defaultProps} value="hello" disabled={true} />)

    const textarea = screen.getByPlaceholderText('Ask about the codebase...')
    expect(textarea).toBeDisabled()
  })

  it('renders the model selector', () => {
    render(<ChatInput {...defaultProps} />)

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
  })

  it('renders the skillPicker slot when provided', () => {
    render(
      <ChatInput
        {...defaultProps}
        skillPicker={<button data-testid="skill-picker">Skills</button>}
      />,
    )

    expect(screen.getByTestId('skill-picker')).toBeInTheDocument()
  })
})
