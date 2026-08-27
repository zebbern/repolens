import { forwardRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeIndex } from '@/lib/code/code-index'
import type { FileNode } from '@/types/repository'

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
})

const diagramHarness = vi.hoisted(() => ({
  repositorySession: { id: 1 },
  generateDiagram: vi.fn(),
  tabCache: new Map<string, unknown>(),
}))

vi.mock('@/providers', () => ({
  useRepositoryData: () => ({
    codebaseAnalysis: {
      files: new Map([['src/index.ts', { types: [], classes: [], jsxComponents: [] }]]),
      graph: { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() },
      topology: { entryPoints: [], hubs: [], connectors: [], leafNodes: [], orphans: [], clusters: [], maxDepth: 0 },
    },
    repositorySession: diagramHarness.repositorySession,
  }),
  useRepositoryActions: () => ({
    getTabCache: (key: string) => diagramHarness.tabCache.get(key),
    setTabCache: (key: string, value: unknown) => diagramHarness.tabCache.set(key, value),
  }),
}))

vi.mock('@/lib/diagrams/diagram-data', () => ({
  getAvailableDiagrams: () => [
    { id: 'treemap', label: 'Treemap', available: true },
    { id: 'topology', label: 'Architecture', available: true },
  ],
  generateProjectSummary: () => ({
    data: {
      languages: [], topHubs: [], topConsumers: [], circularDeps: [], orphanFiles: [],
      entryPoints: [], connectors: [], clusterCount: 0, maxDepth: 0, totalFiles: 1,
      totalLines: 1, frameworkDetected: null, primaryLanguage: 'typescript',
      healthIssues: [], folderBreakdown: [], externalDeps: [],
    },
  }),
  generateDiagram: (...args: unknown[]) => diagramHarness.generateDiagram(...args),
  generateDiagramAsync: vi.fn(),
}))

vi.mock('./diagram-overview', () => ({
  DiagramOverview: ({ onFocusFile }: { onFocusFile: (path: string) => void }) => (
    <button onClick={() => onFocusFile('src/index.ts')}>Focus fixture file</button>
  ),
}))
vi.mock('./diagram-floating-controls', () => ({
  DiagramFloatingControls: () => <div>Floating controls</div>,
}))
vi.mock('./stats-bar', () => ({ StatsBar: () => null }))
vi.mock('./treemap-chart', () => ({
  TreemapChart: forwardRef(function MockTreemap() { return <svg aria-label="Treemap chart" /> }),
}))
vi.mock('./mermaid-diagram', () => ({
  MermaidDiagram: forwardRef(function MockMermaid({ onRenderFailure }: { onRenderFailure?: () => void }, ref) {
    void ref
    return <button onClick={onRenderFailure}>Trigger render failure</button>
  }),
}))

import { DiagramViewer } from './diagram-viewer'

const files = [{ path: 'src/index.ts', name: 'index.ts', type: 'file' }] as FileNode[]
const codeIndex = {
  files: new Map([['src/index.ts', { path: 'src/index.ts', name: 'index.ts', lineCount: 1 }]]),
  totalFiles: 1,
  totalLines: 1,
  isIndexing: false,
  meta: new Map(),
} as unknown as CodeIndex

describe('DiagramViewer failed diagram handling', () => {
  beforeEach(() => {
    diagramHarness.repositorySession = { id: 1 }
    diagramHarness.generateDiagram.mockReset()
    diagramHarness.tabCache.clear()
  })

  it('removes a tab after its Mermaid renderer confirms failure and returns to Overview', async () => {
    const user = userEvent.setup()
    diagramHarness.generateDiagram.mockResolvedValue({
      type: 'topology',
      title: 'Architecture',
      chart: 'flowchart TD\n  one --> two',
      stats: { totalNodes: 2, totalEdges: 1 },
      nodePathMap: new Map(),
    })
    render(<DiagramViewer files={files} codeIndex={codeIndex} />)

    await user.click(screen.getByRole('button', { name: 'Architecture' }))
    await user.click(await screen.findByRole('button', { name: 'Trigger render failure' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Architecture' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('This diagram is unavailable. Returned to Overview.')
    expect(screen.queryByText('Failed to render diagram')).not.toBeInTheDocument()
  })

  it('resets focus and restores failed tabs when the repository session changes', async () => {
    const user = userEvent.setup()
    diagramHarness.generateDiagram.mockResolvedValue({
      type: 'focus',
      title: 'Focus: src/index.ts',
      chart: 'flowchart TD\n  one --> two',
      stats: { totalNodes: 2, totalEdges: 1 },
      nodePathMap: new Map(),
    })
    const view = render(<DiagramViewer files={files} codeIndex={codeIndex} />)

    await user.click(screen.getByRole('button', { name: 'Architecture' }))
    await user.click(await screen.findByRole('button', { name: 'Trigger render failure' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Architecture' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Focus fixture file' }))
    await waitFor(() => expect(screen.getByText('Focus: index.ts')).toBeInTheDocument())

    diagramHarness.repositorySession = { id: 2 }
    view.rerender(<DiagramViewer files={files} codeIndex={codeIndex} />)

    expect(screen.queryByText('Focus: index.ts')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Architecture' })).toBeInTheDocument()
  })

  it('keeps a failed tab hidden after the Diagram viewer is remounted for the same repository', async () => {
    const user = userEvent.setup()
    diagramHarness.generateDiagram.mockResolvedValue({
      type: 'topology',
      title: 'Architecture',
      chart: 'flowchart TD\n  one --> two',
      stats: { totalNodes: 2, totalEdges: 1 },
      nodePathMap: new Map(),
    })
    const firstView = render(<DiagramViewer files={files} codeIndex={codeIndex} />)

    await user.click(screen.getByRole('button', { name: 'Architecture' }))
    await user.click(await screen.findByRole('button', { name: 'Trigger render failure' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Architecture' })).not.toBeInTheDocument())

    firstView.unmount()
    render(<DiagramViewer files={files} codeIndex={codeIndex} />)

    expect(screen.queryByRole('button', { name: 'Architecture' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true')
  })
})
