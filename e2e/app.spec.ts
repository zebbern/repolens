import { test, expect, type Page } from '@playwright/test';
import {
  FIXTURE_OWNER,
  FIXTURE_REPO,
  installGitHubRepositoryFixture,
} from './fixtures/github-repository'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForBodyText(page: Page, text: string, timeoutMs = 30_000) {
  await page.waitForFunction(
    (t) => document.body.textContent?.includes(t) ?? false,
    text,
    { timeout: timeoutMs },
  )
}

// ---------------------------------------------------------------------------
// Basic app tests
// ---------------------------------------------------------------------------

test.describe('App', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/RepoLens/i);
  });
});

// ---------------------------------------------------------------------------
// URL rewrite: /{owner}/{repo} → /?repo=...
//
// The proxy rewrites paths like /owner/repo to /?repo=https://github.com/owner/repo
// so both URL formats load the same repo.
// ---------------------------------------------------------------------------

test.describe('URL rewrite', () => {
  test('/{owner}/{repo} path loads the repo the same as ?repo= query param', async ({ page }) => {
    await installGitHubRepositoryFixture(page)

    // Navigate using the path-based URL — proxy internally rewrites
    // to /?repo=https://github.com/repolens-fixtures/sample-repository (rewrite, NOT redirect,
    // so browser URL stays as the original path)
    await page.goto(`/${FIXTURE_OWNER}/${FIXTURE_REPO}`, { waitUntil: 'networkidle' })
    await expect(page).toHaveTitle(/RepoLens/i)

    // URL should NOT have changed (rewrite, not redirect)
    expect(page.url()).toContain(`/${FIXTURE_OWNER}/${FIXTURE_REPO}`)

    // The page should load and auto-connect. Wait for the repo name to appear
    // in the page body (e.g. in recently analyzed, file tree, or header)
    await waitForBodyText(page, `${FIXTURE_OWNER}/${FIXTURE_REPO}`, 30_000)
  })

  test('reserved segment /compare is not rewritten', async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto('/compare', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle(/RepoLens/i)

    // Should show the Compare page, not a repo
    await expect(
      page.getByRole('heading', { name: /Compare Repositories/i }),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('reserved segment /api is not rewritten to a repo', async ({ page }) => {
    test.setTimeout(30_000)

    // Use fetch-style request to avoid browser navigation/redirect issues
    const response = await page.request.get('/api/models')
    // API routes should return a response, not get rewritten to /?repo=...
    expect(response.url()).toContain('/api/')
    expect(response.status()).toBeLessThan(500)
  })

  test('three-segment paths are not rewritten (only exactly 2 segments)', async ({ page }) => {
    test.setTimeout(60_000)

    // /owner/repo/extra should NOT match the rewrite rule
    await page.goto('/public-apis/public-apis/extra', { waitUntil: 'domcontentloaded' })

    // Should show 404 or the normal routing behavior, not the repo page
    await page.waitForFunction(
      () => {
        const text = document.body.textContent ?? ''
        return text.includes('404') || text.includes('not found') ||
          text.includes('Not Found') || text.includes('Page not found')
      },
      { timeout: 30_000 },
    )
  })
})
