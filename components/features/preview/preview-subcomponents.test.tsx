import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DefaultContent } from './default-content'
import { LoadingWithStatus } from './loading-with-status'

describe('DefaultContent', () => {
  it('renders without crashing', () => {
    render(<DefaultContent />)
    expect(screen.getByText('Preview')).toBeInTheDocument()
  })

  it('displays the Code2 icon area', () => {
    const { container } = render(<DefaultContent />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

describe('LoadingWithStatus', () => {
  it('renders without crashing', () => {
    render(<LoadingWithStatus />)
    expect(screen.getByText('Generating component...')).toBeInTheDocument()
  })

  it('shows a loading spinner', () => {
    const { container } = render(<LoadingWithStatus />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('displays informational text', () => {
    render(<LoadingWithStatus />)
    expect(screen.getByText(/may take a few moments/i)).toBeInTheDocument()
  })
})
