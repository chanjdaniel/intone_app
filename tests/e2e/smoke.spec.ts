import { expect, test } from '@playwright/test'

test('the production build opens on the home screen', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Intone' }),
  ).toBeVisible()
  await expect(page).toHaveTitle('Intone')
})
