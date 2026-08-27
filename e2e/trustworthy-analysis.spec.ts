import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  assertNoUnexpectedFixtureRoutes,
  installGitHubRepositoryFixture,
  type GitHubFixtureScenario,
} from './fixtures/github-repository'

test.afterEach(async ({ page }) => {
  await assertNoUnexpectedFixtureRoutes(page)
})

async function openLanding(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Understand Any GitHub Repository' })).toBeVisible()
  await expect(page.locator('input[placeholder*="github.com"]:visible').first()).toBeEditable()
}

async function connectFixture(
  page: Page,
  testInfo: TestInfo,
  scenario: GitHubFixtureScenario,
) {
  const fixture = await installGitHubRepositoryFixture(page, scenario, testInfo)
  await openLanding(page)
  await page.locator('input[placeholder*="github.com"]:visible').first().fill(fixture.repositoryUrl)
  const connectButton = page.getByRole('button', { name: 'Connect Repository' })
  await expect(connectButton).toBeEnabled()
  await connectButton.click()
  await expect(page.getByText(`${fixture.owner}/${fixture.repo}`).first()).toBeVisible()
  return fixture
}

async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tablist', { name: 'Preview tabs' }).getByRole('tab', { name, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

async function expectExactRenderedSource(page: Page, source: string): Promise<void> {
  await expect.poll(async () => {
    const lines = await page.locator('tr[data-line] td:last-child').allTextContents()
    return lines.join('\n')
  }).toBe(source)
}

async function openIssuesView(page: Page, name: 'Overview' | 'Issues' | 'Compliance'): Promise<void> {
  const tab = page.getByRole('tablist', { name: 'View mode' }).getByRole('tab', { name, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

async function readCachedContentKind(page: Page, repositoryKey: string): Promise<string | null> {
  return page.evaluate(async (key) => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open('repolens-cache')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('repos', 'readonly')
      const entryRequest = transaction.objectStore('repos').get(key)
      entryRequest.onerror = () => reject(entryRequest.error)
      entryRequest.onsuccess = () => resolve(entryRequest.result?.content?.kind ?? null)
    }
  }), repositoryKey)
}

async function readDurableSource(page: Page, contentKey: string): Promise<string | null> {
  return page.evaluate(async (key) => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open('repolens-content')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('files', 'readonly')
      const sourceRequest = transaction.objectStore('files').get(key)
      sourceRequest.onerror = () => reject(sourceRequest.error)
      sourceRequest.onsuccess = () => resolve(sourceRequest.result ?? null)
    }
  }), contentKey)
}

test.describe('deterministic trustworthy-analysis flows', () => {
  test('keeps the editor usable while the sidebar opens as a mobile drawer @mobile', async ({ page }, testInfo) => {
    const fixture = await connectFixture(page, testInfo, 'complete')
    await openTab(page, 'Code')

    await expect(page.getByRole('complementary', { name: 'Code sidebar' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Open explorer sidebar' }).click()

    const drawer = page.getByRole('dialog', { name: 'Explorer sidebar' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('treeitem', { name: /src/i }).click()
    await drawer.getByRole('treeitem', { name: /index\.ts/i }).click()

    await expect(drawer).not.toBeVisible()
    await expectExactRenderedSource(page, fixture.expectedSource)
  })

  test('gives the mobile chat sheet an accessible description @mobile', async ({ page }, testInfo) => {
    await installGitHubRepositoryFixture(page, 'complete', testInfo)
    await openLanding(page)

    await page.getByRole('button', { name: 'Open chat' }).click()

    const chatDialog = page.getByRole('dialog', { name: 'Chat' })
    await expect(chatDialog).toBeVisible()
    await expect(chatDialog).toHaveAccessibleDescription(
      'Chat with RepoLens about repository code and analysis.',
    )
  })

  test('returns focus to the mobile chat opener after Escape @mobile', async ({ page }, testInfo) => {
    await installGitHubRepositoryFixture(page, 'complete', testInfo)
    await openLanding(page)

    const openChat = page.getByRole('button', { name: 'Open chat' })
    await openChat.click()
    const chatDialog = page.getByRole('dialog', { name: 'Chat' })
    await expect(chatDialog).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(chatDialog).not.toBeVisible()
    await expect(openChat).toBeFocused()
  })

  test('keeps focus on Repo when keyboard navigation returns to the landing tab', async ({ page }, testInfo) => {
    await installGitHubRepositoryFixture(page, 'complete', testInfo)
    await openLanding(page)

    const tablist = page.getByRole('tablist', { name: 'Preview tabs' })
    const issues = tablist.getByRole('tab', { name: 'Issues', exact: true })
    await issues.click()
    await issues.press('ArrowRight')

    const diagram = tablist.getByRole('tab', { name: 'Diagram', exact: true })
    await expect(diagram).toBeFocused()
    await diagram.press('Home')

    const repo = tablist.getByRole('tab', { name: 'Repo', exact: true })
    await expect(repo).toHaveAttribute('aria-selected', 'true')
    await page.waitForTimeout(150)
    await expect(repo).toBeFocused()
  })

  test('orders diagram views and keeps preview actions pinned while zooming', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'complete')
    await openTab(page, 'Diagram')

    const overview = page.getByRole('button', { name: 'Overview', exact: true })
    const diagramViews = overview.locator('..').getByRole('button')
    await expect(diagramViews).toHaveText(['Overview', 'Treemap', 'Architecture', 'Entry Points'])

    await page.getByRole('button', { name: 'Architecture', exact: true }).click()
    const fullscreen = page.getByRole('button', { name: 'Fullscreen' })
    await expect(fullscreen).toBeVisible()

    const actionBar = fullscreen.locator('..')
    const viewport = actionBar.locator('..')
    await expect(viewport).toHaveClass(/\bgroup\b.*\brelative\b/)
    await viewport.hover({ position: { x: 20, y: 20 } })

    const beforeViewport = await viewport.boundingBox()
    const beforeActions = await actionBar.boundingBox()
    expect(beforeViewport).not.toBeNull()
    expect(beforeActions).not.toBeNull()
    expect(Math.abs(beforeActions!.y - beforeViewport!.y - 12)).toBeLessThanOrEqual(1)
    expect(Math.abs(beforeViewport!.x + beforeViewport!.width - beforeActions!.x - beforeActions!.width - 12)).toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect(viewport.locator(':scope > div[style*="transform"]')).toHaveAttribute('style', /scale\(1\.15\)/)

    const afterActions = await actionBar.boundingBox()
    expect(afterActions).not.toBeNull()
    expect(afterActions!.x).toBeCloseTo(beforeActions!.x, 1)
    expect(afterActions!.y).toBeCloseTo(beforeActions!.y, 1)
  })

  test('connects through the real form and opens exact indexed source', async ({ page }, testInfo) => {
    const fixture = await connectFixture(page, testInfo, 'complete')
    await expect(page.getByRole('status').filter({ hasText: '3 supported files indexed.' })).toBeVisible()

    await openTab(page, 'Code')
    await page.getByRole('treeitem', { name: /src/i }).click()
    await page.getByRole('treeitem', { name: /index\.ts/i }).click()
    await expect(page.getByText('fixtureGreeting', { exact: false }).first()).toBeVisible()
    await expectExactRenderedSource(page, fixture.expectedSource)
  })

  test('auto-dismisses complete coverage and exposes a manual close control', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'complete')
    const coverage = page.getByRole('status').filter({ hasText: '3 supported files indexed.' })

    await expect(coverage.getByRole('button', { name: 'Dismiss repository coverage' })).toBeVisible()
    await expect(coverage).not.toBeVisible({ timeout: 12_000 })

    await page.reload()
    const restoredCoverage = page.getByRole('status').filter({ hasText: '3 supported files indexed.' })
    await expect(restoredCoverage).toBeVisible()
    await restoredCoverage.getByRole('button', { name: 'Dismiss repository coverage' }).click()
    await expect(restoredCoverage).not.toBeVisible()
  })

  test('reveals every path excluded from incomplete issue analysis', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'analysisFailures')
    await openTab(page, 'Issues')

    const warning = page.getByRole('status').filter({ hasText: 'Issue scan coverage incomplete' })
    const taintFailure = warning.getByText(/^taint:/).locator('..')
    await expect(warning).toBeVisible()
    await expect(taintFailure.getByText('src/unavailable-0.ts', { exact: true })).toBeVisible()
    await expect(taintFailure.getByText('src/unavailable-2.ts', { exact: true })).toBeVisible()
    await expect(taintFailure.getByText('src/unavailable-3.ts', { exact: true })).toHaveCount(0)

    await taintFailure.getByRole('button', { name: 'View 3 more taint paths' }).click()
    await expect(taintFailure.getByText('src/unavailable-5.ts', { exact: true })).toBeVisible()
    await taintFailure.getByRole('button', { name: 'Show fewer taint paths' }).click()
    await expect(taintFailure.getByText('src/unavailable-3.ts', { exact: true })).toHaveCount(0)

    const viewTabs = page.getByRole('tablist', { name: 'View mode' })
    await expect(viewTabs.getByRole('tab')).toHaveText(['Overview', 'Issues', 'Compliance'])
    await expect(viewTabs.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')

    const riskScore = page.locator('[aria-label^="Project Risk Score:"]')
    const healthScore = page.locator('[aria-label^="Health grade "]')
    await expect(riskScore).toBeVisible()
    await expect(healthScore).toBeVisible()
    expect(await riskScore.evaluate(element => element.getBoundingClientRect().height))
      .toBe(await healthScore.evaluate(element => element.getBoundingClientRect().height))

    await openIssuesView(page, 'Issues')
    await expect(page.getByRole('button', { name: /Missing Lockfile/ })).toBeVisible()

    await openIssuesView(page, 'Compliance')
    const accessControl = page.getByRole('button', { name: /Broken Access Control/ })
    await accessControl.click()
    await expect(page.getByText('Mapped findings', { exact: true }).first()).toBeVisible()
    const pathTraversal = page.getByRole('button', { name: /Potential Path Traversal/ }).first()
    await pathTraversal.click()
    await expect(page.getByText('src/download.ts:3', { exact: true }).first()).toBeVisible()
  })

  test('renders dependency metadata and a known health grade from production-shaped fixtures', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'dependencies')
    await openTab(page, 'Deps')

    const dependency = page.getByRole('row').filter({ hasText: 'fixture-dependency' })
    await expect(dependency).toBeVisible()
    await expect(dependency).toContainText('1.0.0')
    await expect(dependency).toContainText('1.1.0')
    await expect(dependency.getByLabel('Health grade: A')).toBeVisible()
  })

  test('searches and scans an edited medium repository through IndexedDB workers', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const fixture = await connectFixture(page, testInfo, 'mediumIdb')
    const repositoryKey = `${fixture.owner}/${fixture.repo}`

    await expect.poll(() => readCachedContentKind(page, repositoryKey)).toBe('idb')

    // Reconnect through the URL-backed cache so edits use a session overlay over
    // the immutable shared IndexedDB snapshot.
    await page.reload()
    await expect(page.getByText(repositoryKey).first()).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '3 supported files indexed.' })).toBeVisible()

    await openTab(page, 'Code')
    await page.getByRole('button', { name: 'Open search sidebar' }).click()
    const search = page.getByPlaceholder('Search (Ctrl+Shift+F)')
    await search.fill('idbWorkerNeedle')
    await expect(page.getByText('1 results in 1 files', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Toggle replace' }).click()
    await page.getByPlaceholder('Replace').fill('idbEditedWorkerNeedle')
    await page.getByRole('button', { name: 'Replace all matches in index.ts' }).click()

    await search.fill('idbEditedWorkerNeedle')
    await expect(page.getByText('1 results in 1 files', { exact: true })).toBeVisible()
    await expect.poll(() => readDurableSource(
      page,
      `${fixture.contentStoreKey}:src/index.ts`,
    )).toContain('idbWorkerNeedle')

    await openTab(page, 'Issues')
    await openIssuesView(page, 'Issues')
    await expect(page.getByRole('button', { name: /Missing Lockfile/ })).toBeVisible()
    await expect(page.getByText('Automated findings are heuristic. Review them before acting.')).toBeVisible()
  })

  test('returns focus to Explorer after closing the only code tab', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'complete')
    await openTab(page, 'Code')
    await page.getByRole('treeitem', { name: /src/i }).click()
    await page.getByRole('treeitem', { name: /index\.ts/i }).click()

    await page.getByRole('button', { name: 'Close index.ts' }).click()

    await expect(page.getByRole('button', { name: 'Open explorer sidebar' })).toBeFocused()
    await expect(page.getByRole('tablist', { name: 'Open files' })).toHaveCount(0)
  })

  test('keeps complete coverage visible while tabs reach terminal outcomes', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'complete')
    const coverage = page.getByRole('status').filter({ hasText: '3 supported files indexed.' })
    await expect(coverage).toBeVisible()
    await coverage.hover()

    await openTab(page, 'Issues')
    await expect(page.getByText('Automated findings are heuristic. Review them before acting.')).toBeVisible()
    await expect(coverage).toBeVisible()

    await openTab(page, 'Docs')
    await expect(page.getByRole('button', { name: 'Set up API key' })).toBeVisible()
    await expect(coverage).toBeVisible()

    await openTab(page, 'Changelog')
    await expect(page.getByRole('button', { name: 'Set up API key' })).toBeVisible()
    await expect(coverage).toBeVisible()

    await openTab(page, 'Issues')
    await expect(page.getByText('Automated findings are heuristic. Review them before acting.')).toBeVisible()
    await expect(coverage).toBeVisible()
  })

  test('shows truncated-tree coverage and failed-subtree details', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'truncatedTree')
    await expect(page.getByText('Partial coverage — results may omit files.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Details' }).click()
    await expect(page.getByRole('heading', { name: 'Repository coverage details' })).toBeVisible()
    await expect(page.getByText('Partial (GitHub tree was truncated)', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Failed subtrees (1)' })).toBeVisible()
    await expect(page.getByText('vendor', { exact: true })).toBeVisible()
  })

  test('surfaces failed file loading without claiming complete coverage', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'fileFailure')
    await expect(page.getByText('Partial coverage — results may omit files.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Details' }).click()
    await expect(page.getByRole('heading', { name: 'File-load failures (1)' })).toBeVisible()
    await expect(page.getByText('src/failing.ts', { exact: true })).toBeVisible()
    await expect(page.getByText(/Fixture file fetch failed|Request failed/i)).toBeVisible()
  })

  test('loads on-demand source only after a real file click', async ({ page }, testInfo) => {
    const fixture = await connectFixture(page, testInfo, 'onDemand')
    await expect(page.getByText(/On-demand content — 0 of 3 supported files loaded/)).toBeVisible()

    await openTab(page, 'Code')
    await page.getByRole('treeitem', { name: /src/i }).click()
    await page.getByRole('treeitem', { name: /index\.ts/i }).click()
    await expect(page.getByText('fixtureGreeting', { exact: false }).first()).toBeVisible()
    await expectExactRenderedSource(page, fixture.expectedSource)
    await expect(page.getByText(/On-demand content — 1 of 3 supported files loaded/)).toBeVisible()
  })

  test('gives every tab a terminal state before a repository is connected', async ({ page }, testInfo) => {
    await installGitHubRepositoryFixture(page, 'complete', testInfo)
    await openLanding(page)
    for (const tabName of [
      'Issues',
      'Diagram',
      'Code',
      'Deps',
      'Docs',
      'Changelog',
      'Git History',
      'Pull Requests',
      'Tours',
    ]) {
      await openTab(page, tabName)
      await expect(page.getByRole('heading', { name: 'No repository connected' })).toBeVisible()
    }
  })

  test('opens Settings through the rendered control and shows truthful privacy boundaries', async ({ page }, testInfo) => {
    await installGitHubRepositoryFixture(page, 'complete', testInfo)
    await openLanding(page)
    await page.getByRole('button', { name: 'Open API settings' }).click()
    await expect(page.getByRole('heading', { name: 'API Settings' })).toBeVisible()
    await expect(page.getByText(/Your token is stored in this browser/)).toBeVisible()
    await expect(page.getByText(/may send it through its server for validation, ZIP downloads/i)).toBeVisible()

    await page.getByRole('tab', { name: 'OpenAI' }).click()
    await expect(page.getByText(/Your key is stored in this browser/)).toBeVisible()
    await expect(page.getByText(/selected repository context, and local tool results are sent through the RepoLens server/i)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'API Settings' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Open API settings' })).toBeFocused()
  })

  test('shows the terminal empty Pull Requests state', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'noPullRequests')
    await openTab(page, 'Pull Requests')
    await expect(page.getByText('No pull requests found', { exact: true })).toBeVisible()
  })

  test('selects a populated Pull Request and renders its changed file', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'pullRequest')
    await openTab(page, 'Pull Requests')
    await page.getByRole('button', { name: /Make fixture output deterministic/ }).click()
    await expect(page.getByRole('heading', { name: 'Make fixture output deterministic#7' })).toBeVisible()
    await expect(page.getByText('src/index.ts', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/export const deterministic = true/)).toBeVisible()
  })

  test('builds a local Tour and makes zero AI requests', async ({ page }, testInfo) => {
    const fixture = await connectFixture(page, testInfo, 'complete')
    await openTab(page, 'Tours')
    await page.getByRole('button', { name: 'Build Tour' }).first().click()
    await expect(page.getByRole('heading', { name: 'Build Code Tour' })).toBeVisible()
    await page.getByLabel('Focus path or topic (optional)').fill('src')
    await page.getByRole('button', { name: 'Build Tour' }).last().click()

    await expect(page.getByRole('heading', { name: /src.*Tour/i })).toBeVisible()
    await expect(page.getByText(/stop/).first()).toBeVisible()
    expect(fixture.aiRequests, 'local Tour generation must not call an AI route').toEqual([])
  })
})
