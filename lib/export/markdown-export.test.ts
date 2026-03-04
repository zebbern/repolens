import { describe, it, expect } from 'vitest'
import {
  exportToMarkdown,
  exportIssuesToMarkdown,
  exportSummaryClipboard,
} from './markdown-export'
import type { GitHubRepo } from '@/types/repository'
import type { CodeIndex } from '@/lib/code/code-index'
import type { FullAnalysis } from '@/lib/code/import-parser'
import type { ScanResults, CodeIssue } from '@/lib/code/issue-scanner'
import type { ProjectSummary } from '@/lib/diagrams/types'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createRepo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    owner: 'acme',
    name: 'widget',
    fullName: 'acme/widget',
    description: 'Widget toolkit',
    defaultBranch: 'main',
    stars: 100,
    forks: 20,
    language: 'TypeScript',
    topics: [],
    isPrivate: false,
    url: 'https://github.com/acme/widget',
    openIssuesCount: 5,
    pushedAt: '2025-01-01T00:00:00Z',
    license: 'MIT',
    ...overrides,
  }
}

function createCodeIndex(overrides: Partial<CodeIndex> = {}): CodeIndex {
  return {
    files: new Map(),
    totalFiles: 50,
    totalLines: 3000,
    isIndexing: false,
    ...overrides,
  }
}

function createAnalysis(overrides: Partial<FullAnalysis> = {}): FullAnalysis {
  return {
    files: new Map(),
    graph: {
      edges: new Map(),
      reverseEdges: new Map(),
      circular: [],
      externalDeps: new Map(),
    },
    topology: {
      entryPoints: ['src/index.ts'],
      hubs: ['src/utils.ts'],
      orphans: ['src/unused.ts'],
      leafNodes: [],
      connectors: [],
      clusters: [],
      depthMap: new Map(),
      maxDepth: 3,
    },
    detectedFramework: 'Next.js',
    primaryLanguage: 'TypeScript',
    ...overrides,
  }
}

function createScanResults(
  overrides: Partial<ScanResults> = {},
  issues: CodeIssue[] = [],
): ScanResults {
  const critical = issues.filter(i => i.severity === 'critical').length
  const warning = issues.filter(i => i.severity === 'warning').length
  const info = issues.filter(i => i.severity === 'info').length
  return {
    issues,
    summary: {
      total: issues.length,
      critical,
      warning,
      info,
      bySecurity: 0,
      byBadPractice: 0,
      byReliability: 0,
    },
    healthGrade: 'B',
    healthScore: 75,
    ruleOverflow: new Map(),
    languagesDetected: ['TypeScript'],
    rulesEvaluated: 20,
    scannedFiles: 50,
    scannedAt: new Date('2025-06-01T00:00:00Z'),
    securityGrade: 'A',
    qualityGrade: 'A',
    issuesPerKloc: 0,
    isPartialScan: false,
    suppressionCount: 0,
    ...overrides,
  }
}

function createIssue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: 'issue-1',
    ruleId: 'no-console',
    category: 'bad-practice',
    severity: 'warning',
    title: 'Console log detected',
    description: 'Remove console.log before production',
    file: 'src/app.ts',
    line: 42,
    column: 1,
    snippet: 'console.log("debug")',
    suggestion: 'Use a proper logger',
    ...overrides,
  }
}

function createSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    languages: [
      { lang: 'typescript', files: 30, lines: 2000, pct: 66.7 },
      { lang: 'css', files: 10, lines: 500, pct: 16.7 },
    ],
    topHubs: [{ path: 'src/utils.ts', importerCount: 12 }],
    topConsumers: [{ path: 'src/app.ts', depCount: 8 }],
    circularDeps: [],
    orphanFiles: ['src/legacy.ts'],
    entryPoints: ['src/index.ts'],
    connectors: [],
    clusterCount: 3,
    maxDepth: 4,
    totalFiles: 50,
    totalLines: 3000,
    frameworkDetected: 'Next.js',
    primaryLanguage: 'TypeScript',
    healthIssues: ['Large file detected'],
    folderBreakdown: [],
    externalDeps: [{ pkg: 'react', usedByCount: 15 }],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests — exportToMarkdown
// ---------------------------------------------------------------------------

describe('exportToMarkdown', () => {
  it('starts with the repo name as a heading', () => {
    const md = exportToMarkdown(createRepo(), createCodeIndex(), null, null, null)
    expect(md).toMatch(/^# acme\/widget — Analysis Report/)
  })

  it('includes repository metadata table', () => {
    const md = exportToMarkdown(createRepo(), createCodeIndex(), null, null, null)
    expect(md).toContain('| URL | https://github.com/acme/widget |')
    expect(md).toContain('| Default branch | `main` |')
    expect(md).toContain('| Stars |')
    expect(md).toContain('| Primary language | TypeScript |')
  })

  it('includes codebase overview stats', () => {
    const md = exportToMarkdown(createRepo(), createCodeIndex(), null, null, null)
    expect(md).toContain('**Files indexed**: 50')
    expect(md).toContain('**Total lines**: 3,000')
  })

  it('includes analysis framework and language when available', () => {
    const md = exportToMarkdown(createRepo(), createCodeIndex(), createAnalysis(), null, null)
    expect(md).toContain('**Detected framework**: Next.js')
    expect(md).toContain('**Primary language**: TypeScript')
  })

  it('includes dependency analysis section', () => {
    const analysis = createAnalysis()
    const md = exportToMarkdown(createRepo(), createCodeIndex(), analysis, null, null)
    expect(md).toContain('## Dependency Analysis')
    expect(md).toContain('**Entry points**: 1')
    expect(md).toContain('**Hub files**: 1')
    expect(md).toContain('**Orphan files**: 1')
    expect(md).toContain('**Max import depth**: 3')
  })

  it('renders circular dependencies when present', () => {
    const analysis = createAnalysis({
      graph: {
        edges: new Map(),
        reverseEdges: new Map(),
        circular: [['a.ts', 'b.ts']],
        externalDeps: new Map(),
      },
    })
    const md = exportToMarkdown(createRepo(), createCodeIndex(), analysis, null, null)
    expect(md).toContain('### Circular Dependencies')
    expect(md).toContain('`a.ts` ↔ `b.ts`')
  })

  it('includes issues section when scan results provided', () => {
    const issue = createIssue({ severity: 'critical', title: 'SQL Injection' })
    const scanResults = createScanResults({}, [issue])
    const md = exportToMarkdown(createRepo(), createCodeIndex(), null, scanResults, null)
    expect(md).toContain('## Issues')
    expect(md).toContain('**Health grade**: B')
    expect(md).toContain('**SQL Injection**')
  })

  it('includes summary section with languages and metrics', () => {
    const summary = createSummary()
    const md = exportToMarkdown(createRepo(), createCodeIndex(), null, null, summary)
    expect(md).toContain('## Project Summary')
    expect(md).toContain('### Languages')
    expect(md).toContain('Typescript')
    expect(md).toContain('### Key Metrics')
    expect(md).toContain('**Module groups**: 3')
  })

  it('includes external dependencies from summary', () => {
    const summary = createSummary()
    const md = exportToMarkdown(createRepo(), createCodeIndex(), null, null, summary)
    expect(md).toContain('### External Dependencies')
    expect(md).toContain('| react | 15 files |')
  })

  it('includes health issues from summary', () => {
    const summary = createSummary()
    const md = exportToMarkdown(createRepo(), createCodeIndex(), null, null, summary)
    expect(md).toContain('### Health Issues')
    expect(md).toContain('Large file detected')
  })

  it('handles empty data gracefully (no analysis, no scan, no summary)', () => {
    const md = exportToMarkdown(createRepo(), createCodeIndex(), null, null, null)
    expect(md).toContain('# acme/widget')
    // Should not throw or contain undefined
    expect(md).not.toContain('undefined')
  })
})

// ---------------------------------------------------------------------------
// Tests — exportIssuesToMarkdown
// ---------------------------------------------------------------------------

describe('exportIssuesToMarkdown', () => {
  it('includes issue title heading with repo name', () => {
    const scanResults = createScanResults()
    const md = exportIssuesToMarkdown(createRepo(), scanResults)
    expect(md).toContain('# Issues Report — acme/widget')
  })

  it('renders issues grouped by severity', () => {
    const issues = [
      createIssue({ id: '1', severity: 'critical', title: 'XSS vuln' }),
      createIssue({ id: '2', severity: 'warning', title: 'Unused var' }),
      createIssue({ id: '3', severity: 'info', title: 'Optional chain' }),
    ]
    const scanResults = createScanResults({}, issues)
    const md = exportIssuesToMarkdown(createRepo(), scanResults)

    expect(md).toContain('### Critical (1)')
    expect(md).toContain('### Warning (1)')
    expect(md).toContain('### Info (1)')
    expect(md).toContain('**XSS vuln**')
  })

  it('shows suggestion when available', () => {
    const issues = [createIssue({ suggestion: 'Use sanitize()' })]
    const scanResults = createScanResults({}, issues)
    const md = exportIssuesToMarkdown(createRepo(), scanResults)
    expect(md).toContain('💡 Use sanitize()')
  })

  it('shows "No issues detected" when issues array is empty', () => {
    const scanResults = createScanResults()
    const md = exportIssuesToMarkdown(createRepo(), scanResults)
    expect(md).toContain('No issues detected.')
  })
})

// ---------------------------------------------------------------------------
// Tests — exportSummaryClipboard
// ---------------------------------------------------------------------------

describe('exportSummaryClipboard', () => {
  it('includes repo name and description', () => {
    const text = exportSummaryClipboard(createRepo(), createCodeIndex(), null, null)
    expect(text).toContain('**acme/widget**')
    expect(text).toContain('Widget toolkit')
  })

  it('includes file and line counts', () => {
    const text = exportSummaryClipboard(createRepo(), createCodeIndex(), null, null)
    expect(text).toContain('50 files')
    expect(text).toContain('3,000 lines')
  })

  it('includes analysis details when provided', () => {
    const analysis = createAnalysis()
    const text = exportSummaryClipboard(createRepo(), createCodeIndex(), analysis, null)
    expect(text).toContain('Framework: Next.js')
    expect(text).toContain('Language: TypeScript')
    expect(text).toContain('Circular deps: 0')
  })

  it('includes health and issue counts when scan results provided', () => {
    const issues = [
      createIssue({ severity: 'critical' }),
      createIssue({ severity: 'warning' }),
    ]
    const scanResults = createScanResults({}, issues)
    const text = exportSummaryClipboard(createRepo(), createCodeIndex(), null, scanResults)
    expect(text).toContain('Health: B')
    expect(text).toContain('1 critical')
    expect(text).toContain('1 warning')
  })

  it('handles "No description" repos', () => {
    const repo = createRepo({ description: null })
    const text = exportSummaryClipboard(repo, createCodeIndex(), null, null)
    expect(text).toContain('No description')
  })
})
