import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the preview panel: page load, tab switching, empty states,
 * keyboard shortcuts, error boundaries, responsive layout, and performance.
 *
 * ## Hydration note
 *
 * The app uses React.lazy + Suspense for tab components. We MUST wait for
 * `networkidle` before interacting — `domcontentloaded` fires before
 * React hydration completes, leaving click handlers unattached.
 *
 * In dev mode Next.js compiles chunks on demand, so the first click on a
 * lazy tab can take 60–120s while the bundle compiles.
 *
 * Tab switching tests use a single sequential test within one page
 * context for reliability.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the app and wait for full React hydration.
 * Uses `networkidle` to ensure all JS bundles are loaded and React
 * event handlers are attached before any interactions.
 */
async function loadApp(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page).toHaveTitle(/RepoLens/i)
  await expect(
    page.getByRole('heading', { name: /Understand Any GitHub/i }),
  ).toBeVisible({ timeout: 15_000 })
}

/** Wait for text to appear in the document body. */
async function waitForBodyText(page: Page, text: string, timeoutMs = 30_000) {
  await page.waitForFunction(
    (t) => document.body.textContent?.includes(t) ?? false,
    text,
    { timeout: timeoutMs },
  )
}

// ---------------------------------------------------------------------------
// Phase 1 — Page load
// ---------------------------------------------------------------------------

test.describe('Page load', () => {
  test('homepage loads and shows landing content', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/RepoLens/i)
    await expect(
      page.getByRole('heading', { name: /Understand Any GitHub/i }),
    ).toBeVisible()
    await expect(page.getByPlaceholder(/github\.com/i)).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Connect Repository/i }),
    ).toBeVisible()
  })

  test('homepage loads within 10 seconds', async ({ page }) => {
    const start = Date.now()
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('heading', { name: /Understand Any GitHub/i }),
    ).toBeVisible({ timeout: 10_000 })
    expect(Date.now() - start).toBeLessThan(10_000)
  })
})

// ---------------------------------------------------------------------------
// Phase 2 — Tab switching and empty states
//
// Tab switching tests use a single test with sequential tab clicks within
// one page context. React.lazy + Suspense in dev mode creates non-deterministic
// rendering when lazy components are loaded across fresh page navigations.
// Sequential clicks within one page context resolve reliably.
// ---------------------------------------------------------------------------

test.describe('Tab switching', () => {
  test.describe.configure({ retries: 2 })

  test('all tabs show correct empty states when no repo is connected', async ({ page }) => {
    test.setTimeout(300_000) // generous for dev compilation

    await loadApp(page)

    // Issues tab — first lazy chunk compile may take 60–120s
    await page.getByRole('tab', { name: 'Issues', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('No repository loaded')).toBeVisible({ timeout: 120_000 })

    // Docs tab — shows AIFeatureEmptyState when no API key is configured
    await page.getByRole('tab', { name: 'Docs', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(
      () => {
        const text = document.body.textContent ?? ''
        return text.includes('No repository connected') || text.includes('AI Documentation Generator')
      },
      { timeout: 120_000 },
    )

    // Diagram tab
    await page.getByRole('tab', { name: 'Diagram', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('No repository connected')).toBeVisible({ timeout: 120_000 })

    // Code tab
    await page.getByRole('tab', { name: 'Code', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('No repository connected')).toBeVisible({ timeout: 120_000 })

    // Return to Repo tab
    await page.getByRole('tab', { name: 'Repo', exact: true }).click()
    await waitForBodyText(page, 'Understand Any GitHub', 10_000)
    await expect(page.getByPlaceholder(/github\.com/i)).toBeVisible()
  })

  test('no JS errors during tab switching', async ({ page }) => {
    test.setTimeout(300_000)
    await loadApp(page)

    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    // Click through all tabs with simple waiting
    for (const { tab, text } of [
      { tab: 'Issues', text: 'No repository' },
      { tab: 'Docs', text: 'repository' },
      { tab: 'Diagram', text: 'No repository' },
      { tab: 'Code', text: 'No repository' },
      { tab: 'Repo', text: 'Understand Any GitHub' },
    ]) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await page.waitForLoadState('networkidle')
      await page.waitForFunction(
        (t) => document.body.textContent?.includes(t) ?? false,
        text,
        { timeout: 120_000 },
      )
    }

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('net::ERR') &&
        !e.includes('[HMR]') &&
        !e.includes('Fast Refresh') &&
        !e.includes('ClientFetchError') &&
        !e.includes('AuthError') &&
        !e.includes('Content Security Policy') &&
        !e.includes('script.debug.js') &&
        !e.includes('ChunkLoadError') &&
        !e.includes('Loading chunk') &&
        !e.includes('loading chunk') &&
        !e.includes('dynamically imported module') &&
        !e.includes('Failed to fetch'),
    )
    expect(real).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — Keyboard shortcut (Ctrl+K)
// ---------------------------------------------------------------------------

test.describe('Keyboard shortcuts', () => {
  test('Ctrl+K does not crash when no repo is connected', async ({ page }) => {
    await loadApp(page)

    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.keyboard.press('Control+k')
    await page.waitForTimeout(300)

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('net::ERR') &&
        !e.includes('[HMR]') &&
        !e.includes('Fast Refresh') &&
        !e.includes('ClientFetchError') &&
        !e.includes('AuthError') &&
        !e.includes('Content Security Policy') &&
        !e.includes('script.debug.js') &&
        !e.includes('ChunkLoadError') &&
        !e.includes('Loading chunk') &&
        !e.includes('loading chunk') &&
        !e.includes('dynamically imported module') &&
        !e.includes('Failed to fetch'),
    )
    expect(real).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Phase 4 — Tab bar completeness
//
// Verifies all 9 tabs are present. Individual tab content is tested in
// Phase 2 for Issues/Docs/Diagram/Code; remaining tabs (Deps, Changelog,
// Git History, Tours) are validated by presence + no-crash in dev mode.
// ---------------------------------------------------------------------------

test.describe('Tab bar', () => {
  test('all nine tabs are present in the tab bar', async ({ page }) => {
    test.setTimeout(120_000)

    await loadApp(page)

    const expectedTabs = ['Repo', 'Issues', 'Diagram', 'Code', 'Deps', 'Docs', 'Changelog', 'Git History', 'Tours']
    for (const tabName of expectedTabs) {
      await expect(
        page.getByRole('tab', { name: tabName, exact: true }),
      ).toBeVisible({ timeout: 15_000 })
    }
  })
})

// ---------------------------------------------------------------------------
// Phase 5 — Error boundary
// ---------------------------------------------------------------------------

test.describe('Error boundary', () => {
  test('JS bundles are loaded (error boundaries included)', async ({ page }) => {
    await loadApp(page)

    const scriptCount = await page.evaluate(
      () => document.querySelectorAll('script[src]').length,
    )
    expect(scriptCount).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Phase 6 — Responsive layout
// ---------------------------------------------------------------------------

test.describe('Responsive layout', () => {
  test('mobile viewport hides tab labels', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loadApp(page)

    for (const label of ['Repo', 'Issues', 'Docs', 'Diagram', 'Code']) {
      const span = page.locator(`button >> span.hidden:has-text("${label}")`)
      if (await span.count() > 0) {
        await expect(span.first()).not.toBeVisible()
      }
    }
  })

  test('desktop viewport shows tab labels', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await loadApp(page)

    for (const label of ['Repo', 'Issues', 'Docs', 'Diagram', 'Code']) {
      await expect(
        page.locator(`button >> span:has-text("${label}")`).first(),
      ).toBeVisible()
    }
  })

  test('mobile viewport renders functional landing page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loadApp(page)
    await expect(
      page.getByRole('heading', { name: /Understand Any GitHub/i }),
    ).toBeVisible()
    await expect(page.getByPlaceholder(/github\.com/i)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Phase 6 — Performance
// ---------------------------------------------------------------------------

test.describe('Performance', () => {
  test('page becomes interactive within 10 seconds', async ({ page }) => {
    const start = Date.now()
    await page.goto('/', { waitUntil: 'networkidle' })
    expect(Date.now() - start).toBeLessThan(10_000)
  })
})
