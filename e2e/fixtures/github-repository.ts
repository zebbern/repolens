import { expect, type Page, type TestInfo } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

export type GitHubFixtureScenario =
  | 'complete'
  | 'dependencies'
  | 'truncatedTree'
  | 'fileFailure'
  | 'mediumIdb'
  | 'onDemand'
  | 'noPullRequests'
  | 'pullRequest'

const OWNER = 'repolens-fixtures'
const TREE_SHA = '1111111111111111111111111111111111111111'
const DEPENDENCY_NAME = 'fixture-dependency'
const BASE_FILES = {
  'README.md': '# Deterministic RepoLens fixture\n\nExact browser-test source.\n',
  'package.json': '{"name":"repolens-e2e-fixture","version":"1.0.0"}\n',
  'src/index.ts': [
    'export function fixtureGreeting(name: string): string {',
    '  return `hello ${name} from deterministic source`',
    '}',
    '',
  ].join('\n'),
  'src/failing.ts': 'export const shouldFailToLoad = true\n',
} as const

const DEPENDENCY_FILES = {
  'README.md': BASE_FILES['README.md'],
  'package.json': JSON.stringify({
    name: 'repolens-e2e-fixture',
    version: '1.0.0',
    dependencies: { [DEPENDENCY_NAME]: '^1.0.0' },
  }),
  'package-lock.json': JSON.stringify({
    name: 'repolens-e2e-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'repolens-e2e-fixture',
        version: '1.0.0',
        dependencies: { [DEPENDENCY_NAME]: '^1.0.0' },
      },
      [`node_modules/${DEPENDENCY_NAME}`]: { version: '1.0.0' },
    },
  }),
  'src/index.ts': BASE_FILES['src/index.ts'],
} as const

const MEDIUM_IDB_SOURCE = [
  'export const idbWorkerNeedle = "stored in IndexedDB"',
  'export function fixtureGreeting(name: string): string {',
  '  return `hello ${name} from deterministic source`',
  '}',
  '',
].join('\n')

const AI_ROUTE = /^\/api\/(?:chat|docs|changelog|inline-actions|issues\/validate)(?:\/|$)/
const controls = new WeakMap<Page, GitHubFixtureControl>()

interface GitHubFixtureControl {
  owner: string
  repo: string
  repositoryUrl: string
  contentStoreKey: string
  expectedSource: string
  aiRequests: string[]
  assertNoUnexpectedRoutes(): Promise<void>
}

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

function fixtureRepoName(scenario: GitHubFixtureScenario, testInfo: TestInfo): string {
  const suffix = testInfo.testId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(-36)
  return `${scenario.toLowerCase()}-${testInfo.parallelIndex}-${suffix}`.slice(0, 90)
}

function filesForScenario(scenario: GitHubFixtureScenario): Record<string, string> {
  if (scenario === 'dependencies') return DEPENDENCY_FILES
  if (scenario === 'fileFailure') {
    return {
      'README.md': BASE_FILES['README.md'],
      'src/index.ts': BASE_FILES['src/index.ts'],
      'src/failing.ts': BASE_FILES['src/failing.ts'],
    }
  }
  if (scenario === 'mediumIdb') {
    return {
      'README.md': BASE_FILES['README.md'],
      'package.json': BASE_FILES['package.json'],
      'src/index.ts': MEDIUM_IDB_SOURCE,
    }
  }
  return {
    'README.md': BASE_FILES['README.md'],
    'package.json': BASE_FILES['package.json'],
    'src/index.ts': BASE_FILES['src/index.ts'],
  }
}

function fileEntries(files: Record<string, string>) {
  return Object.entries(files).map(([path, content], index) => ({
    path,
    mode: '100644',
    type: 'blob' as const,
    sha: String(index + 2).repeat(40),
    size: content.length,
  }))
}

function treeResponse(scenario: GitHubFixtureScenario, files: Record<string, string>) {
  const tree = [
    { path: 'src', mode: '040000', type: 'tree' as const, sha: '9'.repeat(40) },
    ...fileEntries(files),
  ]
  if (scenario !== 'truncatedTree') {
    return { status: 'complete', sha: TREE_SHA, truncated: false, requestCount: 1, tree }
  }
  return {
    status: 'partial',
    sha: TREE_SHA,
    truncated: true,
    requestCount: 3,
    tree,
    reasons: ['truncated'],
    failureDetails: [{
      path: 'vendor',
      reason: 'truncated',
      message: 'GitHub truncated the vendor subtree',
    }],
    failedSubtrees: ['vendor'],
  }
}

function pullRequest() {
  return {
    number: 7,
    title: 'Make fixture output deterministic',
    body: 'Pins the browser fixture output.',
    state: 'open',
    author: 'fixture-author',
    authorAvatarUrl: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    mergedAt: null,
    headRef: 'fixture-determinism',
    baseRef: 'main',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    additions: 3,
    deletions: 1,
    changedFiles: 1,
    url: 'https://github.com/repolens-fixtures/fixture/pull/7',
    isDraft: false,
    labels: ['testing'],
  }
}

function zipball(repo: string, files: Record<string, string>): Buffer {
  const root = `${repo}-${TREE_SHA}/`
  const entries = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [`${root}${path}`, strToU8(content)]),
  )
  return Buffer.from(zipSync(entries, { level: 1 }))
}

export async function installGitHubRepositoryFixture(
  page: Page,
  scenario: GitHubFixtureScenario,
  testInfo: TestInfo,
): Promise<GitHubFixtureControl> {
  const repo = fixtureRepoName(scenario, testInfo)
  const owner = OWNER
  const repositoryUrl = `https://github.com/${owner}/${repo}`
  const unexpectedRoutes: string[] = []
  const aiRequests: string[] = []
  const browserErrors: string[] = []
  const files = filesForScenario(scenario)

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (AI_ROUTE.test(path)) aiRequests.push(`${request.method()} ${path}`)
  })

  if (scenario === 'mediumIdb') {
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  }

  await page.route('**/api/deps{,/**}', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/deps' && request.method() === 'POST') {
      const body = request.postDataJSON() as { packages?: unknown }
      const requestedPackages = Array.isArray(body.packages) ? body.packages : []
      const results = scenario === 'dependencies' && requestedPackages.includes(DEPENDENCY_NAME)
        ? {
            [DEPENDENCY_NAME]: {
              name: DEPENDENCY_NAME,
              version: '1.1.0',
              description: 'Deterministic dependency metadata fixture',
              license: 'MIT',
              maintainers: 2,
              repository: 'https://github.com/repolens-fixtures/fixture-dependency',
              lastPublish: '2026-08-01T00:00:00.000Z',
              weeklyDownloads: 1_000_000,
              downloadTrend: [
                { day: '2026-07-31', downloads: 140_000 },
                { day: '2026-08-01', downloads: 150_000 },
              ],
              deprecated: false,
              homepage: 'https://example.test/fixture-dependency',
            },
          }
        : {}
      await route.fulfill(json({ results, errors: [] }))
      return
    }
    if (path === '/api/deps/cve' && request.method() === 'POST') {
      const body = request.postDataJSON() as { packages?: unknown }
      const requestedPackages = Array.isArray(body.packages) ? body.packages : []
      await route.fulfill(json({
        results: [],
        errors: [],
        scannedPackages: requestedPackages.length,
      }))
      return
    }
    unexpectedRoutes.push(`${route.request().method()} ${path}`)
    await route.fulfill(json({ error: { message: `Unexpected dependency route: ${path}` } }, 501))
  })

  await page.route('**/api/github/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path === '/api/github/repo' && request.method() === 'GET') {
      await route.fulfill(json({
        owner,
        name: repo,
        fullName: `${owner}/${repo}`,
        description: `Controlled ${scenario} browser fixture`,
        defaultBranch: 'main',
        stars: 42,
        forks: 3,
        language: 'TypeScript',
        topics: ['testing'],
        isPrivate: false,
        url: repositoryUrl,
        size: scenario === 'onDemand' ? 300_000 : scenario === 'mediumIdb' ? 75_000 : 12,
        openIssuesCount: 0,
        pushedAt: '2026-08-01T00:00:00.000Z',
        license: 'MIT',
      }))
      return
    }

    if (path === '/api/github/tree' && request.method() === 'GET') {
      await route.fulfill(json(treeResponse(scenario, files)))
      return
    }

    if (path === '/api/github/zipball' && request.method() === 'POST') {
      if (scenario === 'fileFailure') {
        await route.fulfill(json({ error: { message: 'Fixture forces per-file fallback' } }, 503))
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/zip',
          body: zipball(repo, files),
        })
      }
      return
    }

    if (path === '/api/github/file' && request.method() === 'GET') {
      const filePath = url.searchParams.get('path') ?? ''
      if (scenario === 'fileFailure' && filePath === 'src/failing.ts') {
        await route.fulfill(json({ error: { message: 'Fixture file fetch failed' } }, 500))
        return
      }
      const content = files[filePath]
      await route.fulfill(content === undefined
        ? json({ error: { message: `No fixture content for ${filePath}` } }, 404)
        : json({ content }))
      return
    }

    if (path === '/api/github/pulls' && request.method() === 'GET') {
      await route.fulfill(json(scenario === 'pullRequest' ? [pullRequest()] : []))
      return
    }

    if (path === '/api/github/pulls/7' && request.method() === 'GET') {
      await route.fulfill(json(pullRequest()))
      return
    }

    if (path === '/api/github/pulls/7/files' && request.method() === 'GET') {
      await route.fulfill(json([{
        filename: 'src/index.ts',
        status: 'modified',
        additions: 3,
        deletions: 1,
        changes: 4,
        patch: '@@ -1,2 +1,4 @@\n-export const old = true\n+export const deterministic = true',
        contentsUrl: `${repositoryUrl}/blob/main/src/index.ts`,
      }]))
      return
    }

    unexpectedRoutes.push(`${request.method()} ${path}${url.search}`)
    await route.fulfill(json({ error: { message: `Unexpected GitHub route: ${path}` } }, 501))
  })

  const control: GitHubFixtureControl = {
    owner,
    repo,
    repositoryUrl,
    contentStoreKey: `${owner}/${repo}@${TREE_SHA}`,
    expectedSource: files['src/index.ts'],
    aiRequests,
    async assertNoUnexpectedRoutes() {
      expect(unexpectedRoutes, 'unexpected GitHub/dependency requests must fail the test').toEqual([])
      expect(browserErrors, 'medium-IDB browser console and page errors must fail the test').toEqual([])
    },
  }
  controls.set(page, control)
  return control
}

export async function assertNoUnexpectedFixtureRoutes(page: Page): Promise<void> {
  await controls.get(page)?.assertNoUnexpectedRoutes()
}
