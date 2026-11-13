import { Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  ReviewExport,
  StarterPack,
} from '../../src/services/starter-records.ts'
import { launch, withPage } from './take-session.ts'

// The starter set in the built app (docs/starter-set.md): its levels on
// home, a line of one practised with the fake microphone playing a right
// take of it in another voice, its file served from the app's own origin
// under a hashed path kept for good, its credit on the practice screen
// and on /credits; and the review page, reached only by its address, its
// verdicts kept across a reload and saved as one file the script reads.
// Nothing is sent anywhere.

const root = join(import.meta.dirname, '..', '..')

const pack = Schema.decodeUnknownSync(StarterPack)(
  JSON.parse(
    readFileSync(join(root, 'starter', 'pack', 'levels.json'), 'utf8'),
  ),
)

const pairs = pack.levels.find(level => level.kind === 'Pairs')
const rain = pairs?.lines.find(line => line.id === 'ame-ga-suki')
if (pairs === undefined || rain === undefined) {
  throw new Error('The starter pack has no 雨が好き in its pairs.')
}

const rightTake = join(
  root,
  'fixtures',
  'voices',
  'ame-ga-suki',
  'kurono-takehiro',
  'right.wav',
)

const nothingSent = (
  requests: ReadonlyArray<{ url: string; method: string; body: string | null }>,
  origin: string,
) => {
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
}

test('a starter level: listed on home, a line practised, its file kept for good, its credit shown', async ({
  playwright,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin
  const browser = await launch(playwright, rightTake)
  try {
    await withPage(browser, async ({ page, requests, problems }) => {
      const served: Array<{ url: string; cacheControl: string | null }> = []
      page.on('response', response => {
        if (response.url().endsWith('.wav')) {
          served.push({
            url: response.url(),
            cacheControl: response.headers()['cache-control'] ?? null,
          })
        }
      })
      await page.goto('/')
      const starter = page.getByRole('region', { name: 'The starter set' })
      for (const level of pack.levels) {
        await expect(
          starter.getByRole('link', { name: new RegExp(`^${level.name}`) }),
        ).toBeVisible()
      }
      // Home loads no starter file.
      expect(served).toStrictEqual([])

      await starter
        .getByRole('link', { name: new RegExp(`^${pairs.name}`) })
        .click()
      await expect(
        page.getByRole('heading', { name: pairs.name, level: 1 }),
      ).toBeVisible()
      await expect(
        page.getByText(/^Not yet checked by a native speaker\./),
      ).toBeVisible()
      await page
        .getByRole('link', { name: /^雨が好き/ })
        .first()
        .click()
      await expect(
        page.getByRole('heading', { name: 'Copy the line' }),
      ).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByText(
          /^Voice: VOICEVOX:.+Not yet checked by a native speaker\.$/,
        ),
      ).toBeVisible()

      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Recording', exact: true }),
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('timer')).toHaveText(/^0:02 of 0:30$/, {
        timeout: 10_000,
      })
      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(page.getByText(/% match to this clip$/)).toBeVisible({
        timeout: 30_000,
      })
      await expect(
        page.getByText('Kept in your history on this device.'),
      ).toBeVisible()

      // The line's file, from the app's own origin, kept for good.
      expect(served.length).toBeGreaterThan(0)
      for (const response of served) {
        expect(response.url).toMatch(
          new RegExp(`^${origin}/assets/ame-ga-suki-[\\w-]{8}\\.wav$`),
        )
        expect(response.cacheControl).toBe(
          'public, max-age=31536000, immutable',
        )
      }

      await page.goto('/credits')
      await expect(
        page.getByRole('heading', { name: pairs.name, level: 3 }),
      ).toBeVisible()
      for (const line of pack.levels.flatMap(level => level.lines)) {
        await expect(
          page.getByText(`${line.text} (${line.kana}): ${line.credit.author}`),
        ).toHaveCount(1)
      }

      nothingSent(requests, origin)
      expect(problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})

test('the review page: a line heard, verdicts kept across a reload, saved as one file, nothing sent', async ({
  playwright,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin
  const browser = await playwright.chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  try {
    await withPage(browser, async ({ page, requests, problems }) => {
      // Nothing in the app leads to it.
      await page.goto('/')
      await expect(page.locator('a[href="/review"]')).toHaveCount(0)
      await page.goto('/settings')
      await expect(page.locator('a[href="/review"]')).toHaveCount(0)

      await page.goto('/review')
      await expect(
        page.getByRole('heading', {
          name: 'Review the starter lines',
          level: 1,
        }),
      ).toBeVisible()
      const card = page.getByRole('listitem').filter({
        has: page.getByRole('heading', { name: rain.text, level: 3 }),
      })
      await card.getByRole('button', { name: `Play ${rain.text}` }).click()
      await expect(
        card.getByRole('button', { name: `Play ${rain.text}` }),
      ).toBeVisible({ timeout: 10_000 })

      await card
        .getByRole('radio', { name: 'The accent is another: choose it below' })
        .check()
      await card
        .getByRole('combobox', { name: 'Accent type of 雨' })
        .selectOption('0')
      await card.getByLabel('Note, if any').fill('sounds like candy')
      const status = page.getByRole('status')
      await expect(status).toHaveText(
        /^1 of \d+ lines have a verdict\. Your verdicts are kept on this device\.$/,
      )

      await page.reload()
      await expect(
        card.getByRole('combobox', { name: 'Accent type of 雨' }),
      ).toHaveValue('0')
      await expect(card.getByLabel('Note, if any')).toHaveValue(
        'sounds like candy',
      )

      const download = page.waitForEvent('download')
      await page
        .getByRole('button', { name: 'Save the verdicts as a file' })
        .click()
      const file = await download
      expect(file.suggestedFilename()).toMatch(
        /^intone-starter-review-\d{4}-\d{2}-\d{2}\.json$/,
      )
      const path = await file.path()
      const saved = Schema.decodeUnknownSync(ReviewExport)(
        JSON.parse(readFileSync(path, 'utf8')),
      )
      expect(saved.verdicts).toStrictEqual([
        {
          lineId: rain.id,
          verdict: 'correct',
          accentType: 0,
          note: 'sounds like candy',
        },
      ])
      expect(saved.reviewer).toBeUndefined()
      await expect(
        page.getByText(/^Saved 1 verdict as intone-starter-review-/),
      ).toBeVisible()

      nothingSent(requests, origin)
      expect(problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})
