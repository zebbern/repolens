import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ProjectSummaryPanel } from './project-summary'
import type { ProjectSummary } from '@/lib/diagrams/diagram-data'

const summary: ProjectSummary = {
  languages: Array.from({ length: 9 }, (_, i) => ({ lang: `lang-${i}`, files: i + 1, lines: (i + 1) * 10, pct: 10 })),
  folderBreakdown: Array.from({ length: 9 }, (_, i) => ({ folder: `folder-${i}`, files: 1, lines: (i + 1) * 10, pct: 10 })),
  topHubs: Array.from({ length: 9 }, (_, i) => ({ path: `hub-${i}.ts`, importerCount: 9 - i })),
  topConsumers: Array.from({ length: 9 }, (_, i) => ({ path: `consumer-${i}.ts`, depCount: 9 - i })),
  circularDeps: Array.from({ length: 9 }, (_, i) => [`a-${i}.ts`, `b-${i}.ts`]),
  orphanFiles: [],
  entryPoints: [],
  connectors: [],
  externalDeps: [],
  clusterCount: 1,
  maxDepth: 1,
  totalFiles: 9,
  totalLines: 450,
  frameworkDetected: null,
  primaryLanguage: 'typescript',
  healthIssues: [],
}

vi.mock('@/providers', () => ({
  useRepositoryData: () => ({ codebaseAnalysis: {} }),
}))

vi.mock('@/lib/diagrams/diagram-data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/diagrams/diagram-data')>('@/lib/diagrams/diagram-data')
  return { ...actual, generateProjectSummary: () => ({ data: summary }) }
})

function renderSummary() {
  return render(<ProjectSummaryPanel codeIndex={{} as never} />)
}

describe('ProjectSummaryPanel disclosure controls', () => {
  it.each([
    ['Language Breakdown', 'View 1 more language', 'Show fewer languages', 'lang-8'],
    ['Where the Code Lives', 'View 1 more folder', 'Show fewer folders', 'folder-8/'],
    ['Most Imported Files', 'View 1 more imported file', 'Show fewer imported files', 'hub-8.ts'],
    ['Heaviest Files', 'View 1 more file in Heaviest Files', 'Show fewer files in Heaviest Files', 'consumer-8.ts'],
    ['Circular Dependencies', 'View 1 more circular dependency', 'Show fewer circular dependencies', 'a-8.ts'],
  ])('expands and collapses %s', (_section, moreLabel, lessLabel, lastItem) => {
    renderSummary()
    const heading = screen.getAllByRole('heading').find(element => element.textContent?.startsWith(_section))
    if (!heading?.parentElement) throw new Error(`Missing section: ${_section}`)
    const section = heading.parentElement
    const sectionQueries = within(section)

    expect(sectionQueries.getByRole('button', { name: moreLabel })).toHaveAttribute('aria-expanded', 'false')
    expect(sectionQueries.queryByText(lastItem)).not.toBeInTheDocument()

    const disclosure = sectionQueries.getByRole('button', { name: moreLabel })
    fireEvent.click(disclosure)
    expect(sectionQueries.getByRole('button', { name: lessLabel })).toHaveAttribute('aria-expanded', 'true')
    expect(sectionQueries.getByText(lastItem)).toBeInTheDocument()

    fireEvent.click(sectionQueries.getByRole('button', { name: lessLabel }))
    expect(sectionQueries.getByRole('button', { name: moreLabel })).toBeInTheDocument()
    expect(sectionQueries.queryByText(lastItem)).not.toBeInTheDocument()
  })
})
