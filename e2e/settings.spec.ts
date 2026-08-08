import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the settings modal: open/close, tab switching,
 * and presence of key UI elements (GitHub token input, provider tabs).
 *
 * ## Hydration note
 *
 * The app uses React.lazy + Suspense for tab components. We MUST wait for
 * `networkidle` before interacting — `domcontentloaded` fires before
 * React hydration completes, leaving click handlers unattached.
 *
 * In dev mode Next.js compiles chunks on demand, so the first page load
 * can take 60–120s while bundles compile.
 *
 * Settings modal tests use a single sequential test within one page
 * context for reliability (same pattern as preview-tabs.spec.ts).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveTitle(/RepoLens/i)
  await expect(
    page.getByRole('heading', { name: /Understand Any GitHub/i }),
  ).toBeVisible({ timeout: 30_000 })
  // Wait for React hydration — the interactive button proves handlers are attached
  await expect(
    page.getByRole('button', { name: /Connect Repository/i }),
  ).toBeVisible({ timeout: 15_000 })
}

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------

test.describe('Settings modal', () => {
  test('settings modal open, tabs, input, and close all work correctly', async ({ page }) => {
    test.setTimeout(180_000) // generous for dev compilation

    await loadApp(page)

    // --- Open settings via custom event (avoids button click hydration race) ---
    // Retry the event dispatch since the useEffect listener may not be attached yet
    await page.waitForFunction(
      () => {
        window.dispatchEvent(new Event('open-settings'))
        return document.querySelector('[role="dialog"]') !== null
      },
      { timeout: 30_000, polling: 500 },
    )
    await expect(page.getByRole('heading', { name: /API Settings/i })).toBeVisible({ timeout: 10_000 })

    // --- GitHub tab is visible and active by default ---
    const githubTab = page.getByRole('tab', { name: /GitHub/i })
    await expect(githubTab).toBeVisible()
    await expect(githubTab).toHaveAttribute('data-state', 'active')

    // --- GitHub token input is present ---
    const tokenInput = page.locator('[role="tabpanel"] input')
    await expect(tokenInput.first()).toBeVisible({ timeout: 5_000 })

    // --- Can switch between tabs ---
    const tabs = page.getByRole('tab')
    const tabCount = await tabs.count()
    expect(tabCount).toBeGreaterThanOrEqual(2)

    // Click the second tab (first AI provider)
    const secondTab = tabs.nth(1)
    await secondTab.click()
    await expect(secondTab).toHaveAttribute('data-state', 'active')

    // Switch back to GitHub tab
    await githubTab.click()
    await expect(githubTab).toHaveAttribute('data-state', 'active')

    // --- Close with Escape ---
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: /API Settings/i })).not.toBeVisible({ timeout: 10_000 })

    // --- Re-open and close with Close button ---
    await page.evaluate(() => window.dispatchEvent(new Event('open-settings')))
    await expect(page.getByRole('heading', { name: /API Settings/i })).toBeVisible({ timeout: 15_000 })

    const closeButton = page.getByRole('button', { name: 'Close' })
    await expect(closeButton).toBeVisible({ timeout: 5_000 })
    await closeButton.click()
    await expect(page.getByRole('heading', { name: /API Settings/i })).not.toBeVisible({ timeout: 10_000 })
  })
})
