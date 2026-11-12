import { expect, test } from '@playwright/test'

test('the production build opens on the home screen', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Intone' }),
  ).toBeVisible()
  await expect(page).toHaveTitle('Intone')
})

// Headless Chromium fetches no favicon, so this proves the page names an
// icon that decodes, not that a browser asks for no /favicon.ico.
test('the page names an icon that decodes, and nothing it loads answers 400 or more', async ({
  page,
}) => {
  const missing: Array<string> = []
  page.on('response', response => {
    if (response.status() >= 400) {
      missing.push(`${response.status()} ${response.url()}`)
    }
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Intone' }),
  ).toBeVisible()
  const href = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(href).not.toBeNull()
  // An image that will not parse fails to decode, as a broken SVG does.
  const width = await page.evaluate(async (source: string) => {
    const image = new Image()
    image.src = source
    await image.decode()
    return image.naturalWidth
  }, href ?? '')
  expect(width).toBeGreaterThan(0)
  expect(missing).toStrictEqual([])
})
