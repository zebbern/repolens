import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatsBar } from './stats-bar'
import type { DiagramStats } from '@/lib/diagrams/diagram-data'

const baseStats: DiagramStats = {
  totalNodes: 42,
  totalEdges: 38,
}

describe('StatsBar', () => {
  it('renders without crashing', () => {
    render(<StatsBar stats={baseStats} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('displays totalNodes and totalEdges', () => {
    render(<StatsBar stats={baseStats} />)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('38')).toBeInTheDocument()
    expect(screen.getByText('nodes')).toBeInTheDocument()
    expect(screen.getByText('edges')).toBeInTheDocument()
  })

  it('displays avgDepsPerFile when provided', () => {
    render(<StatsBar stats={{ ...baseStats, avgDepsPerFile: 3.5 }} />)
    expect(screen.getByText('3.5')).toBeInTheDocument()
    expect(screen.getByText('avg deps/file')).toBeInTheDocument()
  })

  it('displays circular deps count when present', () => {
    render(
      <StatsBar
        stats={{ ...baseStats, circularDeps: [['a.ts', 'b.ts'], ['c.ts', 'd.ts']] }}
      />,
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('circular')).toBeInTheDocument()
  })

  it('displays mostImported when provided', () => {
    render(
      <StatsBar
        stats={{ ...baseStats, mostImported: { path: 'src/utils.ts', count: 15 } }}
      />,
    )
    expect(screen.getByText('utils.ts')).toBeInTheDocument()
    // Count is in a mixed text node "Most imported: utils.ts (15)" — verify via parent container
    const parentSpan = screen.getByText('utils.ts').parentElement!
    expect(parentSpan.textContent).toContain('15')
  })

  it('displays topology info when provided', () => {
    render(
      <StatsBar
        stats={baseStats}
        topology={{ clusters: 3, maxDepth: 5, orphans: 2, connectors: 1 }}
      />,
    )
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('clusters')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('hides edges when totalEdges is 0', () => {
    render(<StatsBar stats={{ totalNodes: 10, totalEdges: 0 }} />)
    expect(screen.queryByText('edges')).not.toBeInTheDocument()
  })
})
