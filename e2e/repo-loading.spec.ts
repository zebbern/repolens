import { expect, test, type Page } from '@playwright/test'
import {
  FIXTURE_OWNER,
  FIXTURE_REPO,
  FIXTURE_REPOSITORY_URL,
  installGitHubRepositoryFixture,
} from './fixtures/github-repository'

async function loadApp(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page).toHaveTitle(/RepoLens/i)
  await expect(
    page.getByRole('heading', { name: /Understand Any GitHub/i }),
  ).toBeVisible({ timeout: 15_000 })
}

async function openFixtureRepository(page: Page) {
  await installGitHubRepositoryFixture(page)
  await page.goto(`/?repo=${FIXTURE_REPOSITORY_URL}`, { waitUntil: 'networkidle' })
  await expect(page.getByText(`${FIXTURE_OWNER}/${FIXTURE_REPO}`).first()).toBeVisible({
    timeout: 30_000,
  })
}

test.describe('Repo loading with controlled GitHub routes', () => {
  test('loads a repository via query parameter and shows its header', async ({ page }) => {
    await openFixtureRepository(page)
    await expect(page.getByTitle('Export & Share')).toBeVisible()
  })

  test('shows a loading indicator while repository metadata is pending', async ({ page }) => {
    await installGitHubRepositoryFixture(page, { metadataDelayMs: 750 })

    await page.goto(`/?repo=${FIXTURE_REPOSITORY_URL}`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByText(/Connecting|Fetching repository metadata/i).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText(`${FIXTURE_OWNER}/${FIXTURE_REPO}`).first()).toBeVisible({
      timeout: 30_000,
    })
  })

  test('shows an error for an invalid GitHub URL', async ({ page }) => {
    await page.goto('/?repo=https://not-a-valid-url', { waitUntil: 'networkidle' })

    await expect(page.getByText(/Invalid GitHub URL/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('shows a controlled not-found error', async ({ page }) => {
    await installGitHubRepositoryFixture(page)
    await page.goto('/?repo=https://github.com/repolens-fixtures/missing-repository', {
      waitUntil: 'networkidle',
    })

    await expect(page.getByText('Repository not found').first()).toBeVisible({ timeout: 15_000 })
  })

  test('populates the file tree and navigates between fixture files', async ({ page }) => {
    await openFixtureRepository(page)

    const codeTab = page.getByRole('tab', { name: 'Code', exact: true })
    await codeTab.click()
    await expect(codeTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Explorer').first()).toBeVisible({ timeout: 30_000 })

    const readme = page.getByRole('treeitem', { name: /README\.md/i })
    await expect(readme).toBeVisible()
    await readme.click()
    await expect(page.getByText(/deterministic RepoLens browser-test fixture/i)).toBeVisible({
      timeout: 15_000,
    })

    const license = page.getByRole('treeitem', { name: /LICENSE/i })
    await license.click()
    await expect(page.getByText(/Copyright RepoLens fixtures/i)).toBeVisible({ timeout: 15_000 })
  })

  test('connects an example repository through controlled routes', async ({ page }) => {
    await installGitHubRepositoryFixture(page)
    await loadApp(page)

    await page.getByRole('button', { name: /zustand/i }).click()

    await expect(page.getByText('pmndrs/zustand').first()).toBeVisible({ timeout: 30_000 })
  })
})
