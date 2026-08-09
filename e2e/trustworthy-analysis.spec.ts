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

test.describe('deterministic trustworthy-analysis flows', () => {
  test('connects through the real form and opens exact indexed source', async ({ page }, testInfo) => {
    const fixture = await connectFixture(page, testInfo, 'complete')
    await expect(page.getByRole('status').filter({ hasText: '3 supported files indexed.' })).toBeVisible()

    await openTab(page, 'Code')
    await page.getByRole('treeitem', { name: /src/i }).click()
    await page.getByRole('treeitem', { name: /index\.ts/i }).click()
    await expect(page.getByText('fixtureGreeting', { exact: false }).first()).toBeVisible()
    await expectExactRenderedSource(page, fixture.expectedSource)
  })

  test('keeps complete coverage visible while tabs reach terminal outcomes', async ({ page }, testInfo) => {
    await connectFixture(page, testInfo, 'complete')
    const coverage = page.getByText('3 supported files indexed.', { exact: true })
    await expect(coverage).toBeVisible()

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
