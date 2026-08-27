import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthBadge } from '../health-badge'
import type { HealthGrade } from '@/lib/deps/types'

// Mock tooltip to avoid Radix DOM complexity in jsdom
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}))

describe('HealthBadge', () => {
  it.each<{ grade: HealthGrade; expectedColor: string }>([
    { grade: 'A', expectedColor: 'emerald' },
    { grade: 'B', expectedColor: 'blue' },
    { grade: 'C', expectedColor: 'yellow' },
    { grade: 'D', expectedColor: 'orange' },
    { grade: 'F', expectedColor: 'red' },
  ])('renders grade "$grade" with $expectedColor styling', ({ grade, expectedColor }) => {
    render(<HealthBadge grade={grade} score={75} />)

    const badge = screen.getByText(grade)
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain(expectedColor)
  })

  it('has aria-label with grade information', () => {
    render(<HealthBadge grade="A" score={95} />)
    expect(screen.getByLabelText('Health grade: A')).toBeInTheDocument()
  })

  it('shows the numeric score in tooltip content', () => {
    render(<HealthBadge grade="B" score={72} />)
    expect(screen.getByText('Score: 72/100')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <HealthBadge grade="A" score={90} className="extra-class" />,
    )
    const badge = container.querySelector('.extra-class')
    expect(badge).toBeInTheDocument()
  })

  it('renders an explicit unknown state when a score cannot be computed', () => {
    render(<HealthBadge grade={null} score={null} />)

    expect(screen.getByLabelText('Health grade: unknown')).toHaveTextContent('?')
    expect(screen.getByText('Score: Unknown')).toBeInTheDocument()
  })
})
