import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MermaidToolbar } from './mermaid-toolbar'

describe('MermaidToolbar accessibility', () => {
  it('reveals controls for keyboard focus and coarse pointers', () => {
    const { container } = render(
      <MermaidToolbar
        onFullscreen={vi.fn()}
        onToggleTheme={vi.fn()}
        onCopyImage={vi.fn().mockResolvedValue(undefined)}
        onCopySource={vi.fn().mockResolvedValue(undefined)}
        isDarkPreview={false}
      />,
    )

    const toolbar = container.firstElementChild
    expect(toolbar).toHaveClass('group-focus-within:opacity-100')
    expect(toolbar).toHaveClass('[@media(hover:none)]:opacity-100')
  })
})
