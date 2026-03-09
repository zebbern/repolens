import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TreemapChart } from './treemap-chart'
import type { TreemapNode } from '@/lib/diagrams/diagram-data'

const sampleData: TreemapNode[] = [
  { path: 'src/index.ts', name: 'index.ts', lines: 200, language: 'TypeScript' },
  { path: 'src/utils.ts', name: 'utils.ts', lines: 100, language: 'TypeScript' },
  { path: 'src/app.css', name: 'app.css', lines: 50, language: 'CSS' },
]

describe('TreemapChart', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <TreemapChart data={sampleData} width={600} height={400} />,
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders an SVG with correct dimensions', () => {
    const { container } = render(
      <TreemapChart data={sampleData} width={800} height={600} />,
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('800')
    expect(svg.getAttribute('height')).toBe('600')
  })

  it('renders rects for each node', () => {
    const { container } = render(
      <TreemapChart data={sampleData} width={600} height={400} />,
    )
    const rects = container.querySelectorAll('rect')
    expect(rects.length).toBe(sampleData.length)
  })

  it('renders title elements with file path info', () => {
    render(<TreemapChart data={sampleData} width={600} height={400} />)
    // Each node gets a <title> with its path
    const titles = document.querySelectorAll('title')
    const titleTexts = Array.from(titles).map(t => t.textContent)
    expect(titleTexts.some(t => t?.includes('src/index.ts'))).toBe(true)
  })

  it('calls onNodeClick when a node is clicked', () => {
    const onNodeClick = vi.fn()
    const { container } = render(
      <TreemapChart data={sampleData} width={600} height={400} onNodeClick={onNodeClick} />,
    )
    const groups = container.querySelectorAll('g[role="listitem"]')
    if (groups.length > 0) {
      fireEvent.click(groups[0])
      expect(onNodeClick).toHaveBeenCalledWith(expect.any(String))
    }
  })

  it('renders with empty data without crashing', () => {
    const { container } = render(
      <TreemapChart data={[]} width={600} height={400} />,
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  // -----------------------------------------------------------------------
  // Accessibility attributes
  // -----------------------------------------------------------------------

  describe('accessibility', () => {
    it('sets role="img" on the root SVG element', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const svg = container.querySelector('svg')!
      expect(svg).toHaveAttribute('role', 'img')
    })

    it('sets aria-label on the root SVG element', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const svg = container.querySelector('svg')!
      expect(svg).toHaveAttribute('aria-label', 'Codebase file size treemap')
    })

    it('wraps nodes in a group with role="list"', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const listGroup = container.querySelector('g[role="list"]')
      expect(listGroup).toBeInTheDocument()
    })

    it('assigns role="listitem" to each node group', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const listItems = container.querySelectorAll('g[role="listitem"]')
      expect(listItems.length).toBe(sampleData.length)
    })

    it('makes each node focusable with tabIndex={0}', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const listItems = container.querySelectorAll('g[role="listitem"]')
      listItems.forEach((item) => {
        expect(item).toHaveAttribute('tabindex', '0')
      })
    })

    it('sets aria-label with file name and line count on each node', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const listItems = container.querySelectorAll('g[role="listitem"]')
      const firstLabel = listItems[0]?.getAttribute('aria-label') || ''
      expect(firstLabel).toContain('index.ts')
      expect(firstLabel).toContain('lines')
    })
  })

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------

  describe('keyboard navigation', () => {
    it('calls onNodeClick when Enter is pressed on a focused node', () => {
      const onNodeClick = vi.fn()
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} onNodeClick={onNodeClick} />,
      )
      const firstNode = container.querySelector('g[role="listitem"]')!
      fireEvent.keyDown(firstNode, { key: 'Enter' })
      expect(onNodeClick).toHaveBeenCalledWith('src/index.ts')
    })

    it('calls onNodeClick when Space is pressed on a focused node', () => {
      const onNodeClick = vi.fn()
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} onNodeClick={onNodeClick} />,
      )
      const firstNode = container.querySelector('g[role="listitem"]')!
      fireEvent.keyDown(firstNode, { key: ' ' })
      expect(onNodeClick).toHaveBeenCalledWith('src/index.ts')
    })

    it('does not call onNodeClick when an unrelated key is pressed', () => {
      const onNodeClick = vi.fn()
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} onNodeClick={onNodeClick} />,
      )
      const firstNode = container.querySelector('g[role="listitem"]')!
      fireEvent.keyDown(firstNode, { key: 'Tab' })
      expect(onNodeClick).not.toHaveBeenCalled()
    })

    it('shows a focus ring-3 when a node is focused', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const firstNode = container.querySelector('g[role="listitem"]')!
      fireEvent.focus(firstNode)
      // Focus ring is a second <rect> with stroke="hsl(var(--ring))"
      const rects = firstNode.querySelectorAll('rect')
      const focusRing = Array.from(rects).find(
        (r) => r.getAttribute('stroke') === 'hsl(var(--ring))',
      )
      expect(focusRing).toBeTruthy()
    })

    it('removes focus ring-3 on blur-sm', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const firstNode = container.querySelector('g[role="listitem"]')!
      fireEvent.focus(firstNode)
      fireEvent.blur(firstNode)
      const rects = firstNode.querySelectorAll('rect')
      const focusRing = Array.from(rects).find(
        (r) => r.getAttribute('stroke') === 'hsl(var(--ring))',
      )
      expect(focusRing).toBeFalsy()
    })

    it('moves focus ring-3 to next node on ArrowRight', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const nodes = container.querySelectorAll('g[role="listitem"]')
      fireEvent.focus(nodes[0])
      fireEvent.keyDown(nodes[0], { key: 'ArrowRight' })
      // Second node should have the focus ring
      const secondNodeRects = nodes[1].querySelectorAll('rect')
      const focusRing = Array.from(secondNodeRects).find(
        (r) => r.getAttribute('stroke') === 'hsl(var(--ring))',
      )
      expect(focusRing).toBeTruthy()
    })

    it('moves focus ring-3 to previous node on ArrowLeft', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const nodes = container.querySelectorAll('g[role="listitem"]')
      // Focus second node
      fireEvent.focus(nodes[1])
      fireEvent.keyDown(nodes[1], { key: 'ArrowLeft' })
      // First node should now have the focus ring
      const firstNodeRects = nodes[0].querySelectorAll('rect')
      const focusRing = Array.from(firstNodeRects).find(
        (r) => r.getAttribute('stroke') === 'hsl(var(--ring))',
      )
      expect(focusRing).toBeTruthy()
    })

    it('clamps focus at first node on ArrowLeft', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const nodes = container.querySelectorAll('g[role="listitem"]')
      fireEvent.focus(nodes[0])
      fireEvent.keyDown(nodes[0], { key: 'ArrowLeft' })
      // First node should still have the focus ring
      const firstNodeRects = nodes[0].querySelectorAll('rect')
      const focusRing = Array.from(firstNodeRects).find(
        (r) => r.getAttribute('stroke') === 'hsl(var(--ring))',
      )
      expect(focusRing).toBeTruthy()
    })

    it('clamps focus at last node on ArrowRight', () => {
      const { container } = render(
        <TreemapChart data={sampleData} width={600} height={400} />,
      )
      const nodes = container.querySelectorAll('g[role="listitem"]')
      const lastIndex = nodes.length - 1
      fireEvent.focus(nodes[lastIndex])
      fireEvent.keyDown(nodes[lastIndex], { key: 'ArrowRight' })
      // Last node should still have the focus ring
      const lastNodeRects = nodes[lastIndex].querySelectorAll('rect')
      const focusRing = Array.from(lastNodeRects).find(
        (r) => r.getAttribute('stroke') === 'hsl(var(--ring))',
      )
      expect(focusRing).toBeTruthy()
    })
  })

  // -----------------------------------------------------------------------
  // forwardRef
  // -----------------------------------------------------------------------

  describe('forwardRef', () => {
    it('exposes the root SVG element via ref', () => {
      const ref = createRef<SVGSVGElement>()
      render(<TreemapChart ref={ref} data={sampleData} width={600} height={400} />)
      expect(ref.current).toBeInstanceOf(SVGSVGElement)
      expect(ref.current?.tagName).toBe('svg')
    })
  })
})
