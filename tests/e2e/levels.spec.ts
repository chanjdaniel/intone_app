import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { launch, report, trackStates, withPage } from './take-session.ts'

// The practice loop, end to end in the built app with the fake
// microphone playing a right take of the bundled line in another voice:
// its level, a guided take for two stars, a blind take with every curve
// and the level hidden until it ends, for three, the stars kept on the
// device across a reload, and nothing sent anywhere.

const rightTake = join(
  import.meta.dirname,
  '..',
  '..',
  'fixtures',
  'voices',
  'ame-ga-suki',
  'kurono-takehiro',
  'right.wav',
)

const levelPath = '/level/ame-ga-suki'

// Records a take from the button named `button` to its result, the
// voice played in full.
const recordTake = async (page: Page, button: string): Promise<void> => {
  await page.getByRole('button', { name: button, exact: true }).click()
  await expect(page.getByRole('heading', { name: /^Recording/ })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('timer')).toHaveText(/^0:02 of 0:30$/, {
    timeout: 10_000,
  })
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/% match to this clip$/)).toBeVisible({
    timeout: 30_000,
  })
}

const matchOf = async (page: Page): Promise<number> =>
  Number(
    (
      await page
        .getByText(/^\d+%$/)
        .first()
        .textContent()
    )?.replace('%', ''),
  )

test.describe('a level, played to three stars', () => {
  test('the bundled line: hear it, a guided take, a blind take, three stars kept, nothing sent', async ({
    playwright,
    baseURL,
  }) => {
    const browser = await launch(playwright, rightTake)
    try {
      await withPage(browser, async ({ page, requests, problems }) => {
        // The level: its one line, with no stars yet.
        await page.goto(levelPath)
        await expect(
          page.getByRole('heading', { name: '雨が好き', level: 1 }),
        ).toBeVisible()
        await expect(
          page.getByRole('heading', { name: '0 of 3 stars' }),
        ).toBeVisible()
        const row = page.getByRole('link', { name: /^雨が好き/ })
        await expect(
          row.getByRole('img', { name: '0 of 3 stars' }),
        ).toBeVisible()
        await row.click()
        await expect(
          page.getByRole('heading', { name: 'Copy the line' }),
        ).toBeVisible({ timeout: 30_000 })
        const lineStars = page.getByRole('region', {
          name: 'This line’s stars',
        })
        await expect(
          lineStars.getByRole('img', { name: '0 of 3 stars' }),
        ).toBeVisible()

        // Hear the line, by keyboard.
        await page.getByRole('button', { name: 'Hear the line' }).focus()
        await page.keyboard.press('Enter')
        await expect(
          page.getByRole('button', { name: 'Stop', exact: true }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Hear the line' }),
        ).toBeVisible({ timeout: 10_000 })

        // A guided take: the curves drawn as it is said, then the match.
        await page.getByRole('button', { name: 'Record', exact: true }).click()
        await expect(
          page.getByRole('heading', { name: 'Recording', exact: true }),
        ).toBeVisible({ timeout: 30_000 })
        await expect(
          page.getByRole('img', { name: /^Your pitch, drawn as you speak/ }),
        ).toBeVisible()
        await expect(
          page.getByRole('meter', { name: 'Microphone level' }),
        ).toBeVisible()
        await expect(page.getByRole('timer')).toHaveText(/^0:02 of 0:30$/, {
          timeout: 10_000,
        })
        await page.getByRole('button', { name: 'Stop' }).click()
        await expect(page.getByText(/% match to this clip$/)).toBeVisible({
          timeout: 30_000,
        })
        const guided = await matchOf(page)
        expect(guided).toBeGreaterThanOrEqual(90)
        const status = page.getByRole('status').filter({
          hasText: 'match to this clip',
        })
        await expect(status).toContainText(
          'Two stars for this line: 90% or more on a guided take.',
        )
        await expect(
          lineStars.getByRole('img', { name: '2 of 3 stars' }),
        ).toBeVisible()

        // Try again, as often as wanted: nothing is lost.
        await recordTake(page, 'Record again')
        await expect(status).toContainText('This line has 2 of 3 stars.')

        // A blind take: no curve, no level, no closeness until it ends.
        await page
          .getByRole('button', { name: 'Record blind', exact: true })
          .click()
        await expect(
          page.getByText('A blind take', { exact: true }),
        ).toBeVisible()
        await expect(page.locator('canvas')).toHaveCount(0)
        await expect(
          page.getByRole('heading', { name: 'Recording blind' }),
        ).toBeVisible({ timeout: 30_000 })
        expect(await trackStates(page)).toContain('live')
        await expect(page.locator('canvas')).toHaveCount(0)
        await expect(
          page.getByRole('meter', { name: 'Microphone level' }),
        ).toHaveCount(0)
        await expect(page.getByRole('timer')).toHaveText(/^0:02 of 0:30$/, {
          timeout: 10_000,
        })
        await expect(page.locator('canvas')).toHaveCount(0)
        await page.getByRole('button', { name: 'Stop' }).click()
        await expect(
          page.getByRole('heading', { name: 'Your copy, blind' }),
        ).toBeVisible({ timeout: 30_000 })
        // Then everything: both curves, lined up, and the match.
        await expect(page.locator('canvas')).toHaveCount(2)
        await expect(
          page.getByRole('img', {
            name: /^Your pitch curve, lined up with the line's/,
          }),
        ).toBeVisible()
        const blind = await matchOf(page)
        expect(blind).toBeGreaterThanOrEqual(75)
        await expect(status).toContainText(
          'Three stars for this line: 75% or more on a blind take.',
        )
        await expect(
          lineStars.getByRole('img', { name: '3 of 3 stars' }),
        ).toBeVisible()

        // The level's last line offers the level, which has its stars.
        await expect(
          page.getByText('The last line of 雨が好き you can copy.'),
        ).toBeVisible()
        await page
          .getByRole('link', { name: /^See every line and its stars/ })
          .click()
        await expect(
          page.getByRole('heading', { name: '3 of 3 stars' }),
        ).toBeVisible()
        await expect(
          row.getByRole('img', { name: '3 of 3 stars' }),
        ).toBeVisible()

        // Kept on the device: a reload reads them back.
        await page.reload()
        await expect(
          page.getByRole('heading', { name: '3 of 3 stars' }),
        ).toBeVisible()

        await report(test.info(), 'matches', { guided, blind })
        const origin = new URL(baseURL ?? '').origin
        expect(
          requests.filter(
            request =>
              !request.url.startsWith(`${origin}/`) &&
              !request.url.startsWith(`blob:${origin}/`),
          ),
        ).toStrictEqual([])
        expect(
          requests.filter(
            request => request.method !== 'GET' || request.body !== null,
          ),
        ).toStrictEqual([])
        expect(problems).toStrictEqual([])
      })
    } finally {
      await browser.close()
    }
  })
})
