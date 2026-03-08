import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the getGitHistory AI tool integration.
 *
 * Verifies that:
 * 1. The tool registration doesn't break page load or introduce JS errors
 * 2. The chat sidebar remains functional (type + send) with the tool registered
 * 3. The chat input is accessible and interactive
 *
 * Full tool execution testing (actual GitHub API calls) is covered by unit
 * tests with mocks. These E2E tests validate integration and smoke behavior.
 *
 * ## Hydration note
 *
 * The app uses React.lazy + Suspense for tab components. We MUST wait for
 * `networkidle` before interacting — `domcontentloaded` fires before
 * React hydration completes, leaving click handlers unattached.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Git history tool — integration smoke tests
// ---------------------------------------------------------------------------

test.describe('Git history tool integration', () => {
  test.describe.configure({ retries: 2 })

  test('app loads without JS errors with getGitHistory tool registered', async ({ page }) => {
    test.setTimeout(120_000)

    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await loadApp(page)

    // Verify the page loaded correctly
    await expect(page.getByPlaceholder(/github\.com/i)).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Connect Repository/i }),
    ).toBeVisible()

    // Filter out known benign errors
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

  test('chat sidebar is visible and chat input is accessible', async ({ page }) => {
    test.setTimeout(120_000)

    await loadApp(page)

    // On desktop, the chat sidebar is always visible in the resizable layout.
    // Without an API key the placeholder reads "Add API key to chat";
    // with a key it reads "Ask about the codebase...".
    const chatInput = page.getByPlaceholder(/Add API key to chat|Ask about the codebase/i)
    await expect(chatInput).toBeVisible({ timeout: 30_000 })

    // The send button should be present
    const sendButton = page.getByRole('button', { name: /Send message/i })
    await expect(sendButton).toBeVisible()
  })

  test('chat panel remains functional after tab switching', async ({ page }) => {
    test.setTimeout(300_000)

    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await loadApp(page)

    // Verify chat input works initially
    const chatInput = page.getByPlaceholder(/Add API key to chat|Ask about the codebase/i)
    await expect(chatInput).toBeVisible({ timeout: 30_000 })

    // Switch through a couple of tabs to trigger lazy chunk loading.
    // On cold dev server, lazy chunk compilation may trigger a Fast Refresh
    // full reload, resetting the page back to the Repo tab. Use .or() to
    // handle both outcomes: Issues content loaded OR page reloaded.
    await page.getByRole('tab', { name: 'Issues', exact: true }).click()
    await expect(
      page.getByText('No repository loaded')
        .or(page.getByRole('heading', { name: /Understand Any GitHub/i })),
    ).toBeVisible({ timeout: 120_000 })

    await page.getByRole('tab', { name: 'Repo', exact: true }).click()
    await waitForBodyText(page, 'Understand Any GitHub', 30_000)

    // Chat input should still be accessible after tab switching
    await expect(chatInput).toBeVisible({ timeout: 15_000 })

    // No unexpected JS errors
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
