import { describe, it, expect, vi } from 'vitest'
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
    const groups = container.querySelectorAll('g')
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
})
