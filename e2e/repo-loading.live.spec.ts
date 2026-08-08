import { expect, test, type Page } from '@playwright/test'

async function waitForBodyText(page: Page, text: string, timeoutMs = 30_000) {
  await page.waitForFunction(
    (expected) => document.body.textContent?.includes(expected) ?? false,
    text,
    { timeout: timeoutMs },
  )
}

test.describe('Live GitHub repository loading', { tag: '@live' }, () => {
  test('loads a public repository via query parameter', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/?repo=https://github.com/public-apis/public-apis', {
      waitUntil: 'networkidle',
    })
    await waitForBodyText(page, 'public-apis', 120_000)
  })

  test('reports a non-existent public repository', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?repo=https://github.com/thisownerdoesnotexist999/thisrepodoesnotexist999', {
      waitUntil: 'networkidle',
    })
    await expect(page.getByText(/not found|failed/i).first()).toBeVisible({ timeout: 60_000 })
  })

  test('loads and opens files from a public repository', async ({ page }) => {
    test.setTimeout(300_000)
    await page.goto('/?repo=https://github.com/public-apis/public-apis', {
      waitUntil: 'domcontentloaded',
    })

    await expect(page.getByTitle('Export & Share')).toBeVisible({ timeout: 120_000 })
    const codeTab = page.getByRole('tab', { name: 'Code', exact: true })
    await codeTab.click()
    await expect(page.getByText('Explorer').first()).toBeVisible({ timeout: 120_000 })

    const readme = page.getByRole('treeitem', { name: /README/i })
    await expect(readme).toBeVisible({ timeout: 120_000 })
    await readme.click()
    await expect(page.getByText(/README/i).first()).toBeVisible({ timeout: 30_000 })
  })

  test('connects a public example repository', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /zustand/i }).click()
    await expect(page.getByText('pmndrs/zustand').first()).toBeVisible({ timeout: 120_000 })
  })
})
