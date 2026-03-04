import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaintFlowDiagram } from './taint-flow-diagram'

function createFlow(overrides: Partial<{
  source: string
  sink: string
  path: string[]
  startLine: number
  endLine: number
}> = {}) {
  return {
    source: 'req.body',
    sink: 'db.query',
    path: ['req.body', 'userData', 'db.query'],
    startLine: 10,
    endLine: 20,
    ...overrides,
  }
}

describe('TaintFlowDiagram', () => {
  it('renders nothing when path has fewer than 2 steps', () => {
    const { container } = render(<TaintFlowDiagram flow={createFlow({ path: ['single'] })} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when path is empty', () => {
    const { container } = render(<TaintFlowDiagram flow={createFlow({ path: [] })} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the data flow header with line range', () => {
    render(<TaintFlowDiagram flow={createFlow({ startLine: 10, endLine: 20 })} />)
    expect(screen.getByText('Data Flow: Lines 10–20')).toBeInTheDocument()
  })

  it('renders the correct number of steps', () => {
    render(<TaintFlowDiagram flow={createFlow({ path: ['req.body', 'userData', 'db.query'] })} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
  })

  it('renders source step with correct label', () => {
    render(<TaintFlowDiagram flow={createFlow()} />)
    expect(screen.getByText('req.body')).toBeInTheDocument()
    // The source label text
    const sourceLabels = screen.getAllByText('source')
    expect(sourceLabels.length).toBeGreaterThanOrEqual(1)
  })

  it('renders sink step with correct label', () => {
    render(<TaintFlowDiagram flow={createFlow()} />)
    expect(screen.getByText('db.query')).toBeInTheDocument()
    // The sink label text
    const sinkLabels = screen.getAllByText('sink')
    expect(sinkLabels.length).toBeGreaterThanOrEqual(1)
  })

  it('renders intermediate steps', () => {
    render(
      <TaintFlowDiagram
        flow={createFlow({ path: ['req.body', 'transform1', 'transform2', 'db.query'] })}
      />,
    )
    expect(screen.getByText('transform1')).toBeInTheDocument()
    expect(screen.getByText('transform2')).toBeInTheDocument()
  })

  it('has an accessible list with aria-label', () => {
    render(<TaintFlowDiagram flow={createFlow()} />)
    const list = screen.getByRole('list', { name: /taint data flow path/i })
    expect(list).toBeInTheDocument()
  })

  it('renders aria-label on each step describing its role', () => {
    render(<TaintFlowDiagram flow={createFlow({ path: ['req.body', 'userData', 'db.query'] })} />)
    const items = screen.getAllByRole('listitem')

    expect(items[0]).toHaveAttribute('aria-label', expect.stringContaining('Source'))
    expect(items[1]).toHaveAttribute('aria-label', expect.stringContaining('Transform'))
    expect(items[2]).toHaveAttribute('aria-label', expect.stringContaining('Sink'))
  })

  it('renders exactly 2 steps when path has 2 items', () => {
    render(<TaintFlowDiagram flow={createFlow({ path: ['req.body', 'db.query'] })} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
  })

  it('renders connector arrows between steps (not after last)', () => {
    render(<TaintFlowDiagram flow={createFlow({ path: ['a', 'b', 'c'] })} />)
    const arrows = screen.getAllByText('↓')
    // 3 steps → 2 connectors
    expect(arrows).toHaveLength(2)
  })
})
