import { expect, test } from '@playwright/test'

test('loads sindresorhus/yoctocolors through the public UI @live', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await page.locator('input[placeholder*="github.com"]:visible').first().fill('https://github.com/sindresorhus/yoctocolors')
  await page.getByRole('button', { name: 'Connect Repository' }).click()

  await expect(page.getByText('sindresorhus/yoctocolors').first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/supported files indexed|On-demand content|Partial coverage/).first()).toBeVisible({ timeout: 120_000 })
  await page.getByRole('tab', { name: 'Code', exact: true }).click()
  await expect(page.getByText('Explorer').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 60_000 })
})
