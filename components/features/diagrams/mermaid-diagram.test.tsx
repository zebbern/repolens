import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidDiagram } from './mermaid-diagram'

const mermaidHarness = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({
  default: mermaidHarness,
}))

function PortalHarness({
  chart = 'flowchart TD\n  one --> two',
  onRenderFailure,
}: {
  chart?: string
  onRenderFailure?: () => void
}) {
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)

  return (
    <div>
      <div ref={setToolbarTarget} data-testid="diagram-viewport" className="group relative" />
      <MermaidDiagram
        chart={chart}
        toolbarPortalTarget={toolbarTarget}
        onRenderFailure={onRenderFailure}
      />
    </div>
  )
}

describe('MermaidDiagram viewport integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mermaidHarness.parse.mockResolvedValue(true)
    mermaidHarness.render.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>',
      bindFunctions: vi.fn(),
    })
  })

  it('portals preview actions into the untransformed diagram viewport', async () => {
    render(<PortalHarness />)

    const viewport = screen.getByTestId('diagram-viewport')
    expect(await within(viewport).findByRole('button', { name: 'Fullscreen' })).toBeVisible()
    expect(within(viewport).getByRole('button', { name: 'Light preview' })).toBeVisible()
    expect(within(viewport).getByRole('button', { name: 'Copy as PNG' })).toBeVisible()
    expect(within(viewport).getByRole('button', { name: 'Copy source' })).toBeVisible()
  })

  it('reports a confirmed parse failure to the owning diagram view', async () => {
    const onRenderFailure = vi.fn()
    mermaidHarness.parse.mockResolvedValue(false)

    render(<PortalHarness onRenderFailure={onRenderFailure} />)

    await waitFor(() => expect(onRenderFailure).toHaveBeenCalledTimes(1))
  })

  it('reports oversized source before Mermaid returns its silent fallback graphic', async () => {
    const onRenderFailure = vi.fn()
    const oversizedChart = `flowchart TD\n${'  one --> two\n'.repeat(4_000)}`

    render(<PortalHarness chart={oversizedChart} onRenderFailure={onRenderFailure} />)

    await waitFor(() => expect(onRenderFailure).toHaveBeenCalledTimes(1))
    expect(mermaidHarness.parse).not.toHaveBeenCalled()
    expect(mermaidHarness.render).not.toHaveBeenCalled()
  })

  it('does not report a stale failure after the chart owner changes', async () => {
    let resolveFirstParse!: (valid: boolean) => void
    mermaidHarness.parse.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveFirstParse = resolve
    }))
    const firstFailure = vi.fn()
    const nextFailure = vi.fn()
    const { rerender } = render(
      <PortalHarness chart={'flowchart TD\n  first --> pending'} onRenderFailure={firstFailure} />,
    )

    await waitFor(() => expect(mermaidHarness.parse).toHaveBeenCalledTimes(1))
    rerender(<PortalHarness chart={'flowchart TD\n  next --> ready'} onRenderFailure={nextFailure} />)
    resolveFirstParse(false)

    await waitFor(() => expect(mermaidHarness.render).toHaveBeenCalledTimes(1))
    expect(firstFailure).not.toHaveBeenCalled()
    expect(nextFailure).not.toHaveBeenCalled()
  })

  it.each([
    ['flowchart', 'id_src_2f_index_2e_ts'],
    ['classId', 'type_services'],
  ])('maps Mermaid %s DOM ids back to source node ids on click', async (domPrefix, sourceNodeId) => {
    const onNodeClick = vi.fn()
    mermaidHarness.render.mockImplementationOnce(async (renderId: string) => ({
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><g class="node" id="${renderId}-${domPrefix}-${sourceNodeId}-0"><g class="nodeLabel">Open node</g></g></svg>`,
      bindFunctions: vi.fn(),
    }))
    const { container } = render(
      <MermaidDiagram chart="flowchart TD\n  one" onNodeClick={onNodeClick} />,
    )

    const node = await waitFor(() => {
      const element = container.querySelector('.node')
      expect(element).not.toBeNull()
      return element!
    })
    await waitFor(() => {
      fireEvent.click(node)
      expect(onNodeClick).toHaveBeenCalledWith(sourceNodeId)
    })
    expect(onNodeClick).toHaveBeenCalledTimes(1)
  })
})
