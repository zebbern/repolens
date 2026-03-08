import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { SkillSelector } from '../skill-selector'

// ---------------------------------------------------------------------------
// Mock useSkills hook
// ---------------------------------------------------------------------------

const mockUseSkills = vi.fn()

vi.mock('@/hooks/use-skills', () => ({
  useSkills: () => mockUseSkills(),
}))

// cmdk uses ResizeObserver and Element.scrollIntoView — polyfill for jsdom
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(id: string) {
  return {
    id,
    name: `Skill ${id}`,
    description: `Description for ${id}`,
    trigger: `Use when ${id}`,
    relatedTools: ['tool1'],
  }
}

const defaultSkills = [
  makeSkill('security-audit'),
  makeSkill('architecture-review'),
  makeSkill('performance-analysis'),
]

function setupSkills(overrides: Partial<ReturnType<typeof mockUseSkills>> = {}) {
  mockUseSkills.mockReturnValue({
    skills: defaultSkills,
    isLoading: false,
    error: null,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupSkills()
  })

  it('renders trigger button with correct aria-label', () => {
    render(
      <SkillSelector activeSkills={new Set()} onToggle={vi.fn()} />,
    )

    const trigger = screen.getByLabelText('Select skills')
    expect(trigger).toBeInTheDocument()
  })

  it('shows active count when skills are selected', () => {
    render(
      <SkillSelector
        activeSkills={new Set(['security-audit', 'architecture-review'])}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('does not show count when no skills are active', () => {
    render(
      <SkillSelector activeSkills={new Set()} onToggle={vi.fn()} />,
    )

    // Should not render any numeric count
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('opens popover and shows skill names and descriptions', async () => {
    render(
      <SkillSelector activeSkills={new Set()} onToggle={vi.fn()} />,
    )

    fireEvent.click(screen.getByLabelText('Select skills'))

    for (const skill of defaultSkills) {
      expect(await screen.findByText(skill.name)).toBeInTheDocument()
      expect(screen.getByText(skill.description)).toBeInTheDocument()
    }
  })

  it('calls onToggle with skill ID when a skill is clicked', async () => {
    const onToggle = vi.fn()

    render(
      <SkillSelector activeSkills={new Set()} onToggle={onToggle} />,
    )

    fireEvent.click(screen.getByLabelText('Select skills'))

    const skillItem = await screen.findByText('Skill security-audit')
    fireEvent.click(skillItem)

    expect(onToggle).toHaveBeenCalledWith('security-audit')
  })

  it('shows loading spinner when skills are loading', () => {
    setupSkills({ skills: [], isLoading: true })

    render(
      <SkillSelector activeSkills={new Set()} onToggle={vi.fn()} />,
    )

    fireEvent.click(screen.getByLabelText('Select skills'))

    // The loader is an SVG with animate-spin class
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('shows empty state when no skills available', async () => {
    setupSkills({ skills: [] })

    render(
      <SkillSelector activeSkills={new Set()} onToggle={vi.fn()} />,
    )

    fireEvent.click(screen.getByLabelText('Select skills'))

    // cmdk CommandEmpty renders when there are no items matching
    expect(await screen.findByText('No skills available.')).toBeInTheDocument()
  })

  it('shows error state when skills failed to load', () => {
    setupSkills({ skills: [], error: new Error('Network error') })

    render(
      <SkillSelector activeSkills={new Set()} onToggle={vi.fn()} />,
    )

    fireEvent.click(screen.getByLabelText('Select skills'))

    expect(screen.getByText('Failed to load skills')).toBeInTheDocument()
  })
})
