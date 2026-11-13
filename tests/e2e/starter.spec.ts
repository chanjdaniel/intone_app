import { Schema } from 'effect'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  ReviewExport,
  StarterList,
  StarterPack,
} from '../../src/services/starter-records.ts'
import { run } from '../support/run.ts'
import { launch, withPage } from './take-session.ts'

// The starter set in the built app (docs/starter-set.md): its levels on
// home, a line of one practised with the fake microphone playing a right
// take of it in another voice, its file served from the app's own origin
// under a hashed path kept for good, its credit on the practice screen
// and on /credits; and the review page, reached only by its address, its
// verdicts kept across a reload and saved as one file, which the script
// writes into a copy of the list and its pack. Nothing is sent anywhere.

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

// A phrase recorded by a person, on Commons: correcting its accent
// leaves its file as it is, so the script takes the review in with no
// VOICEVOX, as on CI.
const phrases = pack.levels.find(level => level.kind === 'Phrases')
const bridge = phrases?.lines.find(line => line.id === 'hashi-o-watarimasu')
if (bridge === undefined || bridge.words[0]?.accentType !== 2) {
  throw new Error('The starter pack has no 橋を渡ります stated as 橋 2.')
}

// scripts/starter-pack.ts on a copy of the list, its pack and CREDITS.md.
const starterPackScript = (args: ReadonlyArray<string>) =>
  run('node', [
    '--import',
    join(root, 'scripts', 'source-imports.ts'),
    join(root, 'scripts', 'starter-pack.ts'),
    ...args,
  ])

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

test('the review page: a line heard, verdicts kept across a reload, saved as one file the script takes into the list, nothing sent', async ({
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
        has: page.getByRole('heading', { name: bridge.text, level: 3 }),
      })
      await card.getByRole('button', { name: `Play ${bridge.text}` }).click()
      await expect(
        card.getByRole('button', { name: `Play ${bridge.text}` }),
      ).toBeVisible({ timeout: 10_000 })

      await card
        .getByRole('radio', { name: 'The accent is another: choose it below' })
        .check()
      await card
        .getByRole('combobox', { name: 'Accent type of 橋' })
        .selectOption('1')
      await card.getByLabel('Note, if any').fill('sounds like 箸')
      const status = page.getByRole('status')
      await expect(status).toHaveText(
        /^1 of \d+ lines have a verdict\. Your verdicts are kept on this device\.$/,
      )

      await page.reload()
      await expect(
        card.getByRole('combobox', { name: 'Accent type of 橋' }),
      ).toHaveValue('1')
      await expect(card.getByLabel('Note, if any')).toHaveValue(
        'sounds like 箸',
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
          lineId: bridge.id,
          verdict: 'correct',
          accentType: 1,
          note: 'sounds like 箸',
        },
      ])
      expect(saved.reviewer).toBeUndefined()
      await expect(
        page.getByText(/^Saved 1 verdict as intone-starter-review-/),
      ).toBeVisible()

      // The saved file, as the page wrote it, into a copy of the list: the
      // line's first word takes the accent given, with the one stated
      // before, and the pack written from it is current.
      const copy = mkdtempSync(join(tmpdir(), 'starter-review-'))
      try {
        cpSync(join(root, 'starter'), join(copy, 'starter'), {
          recursive: true,
        })
        cpSync(join(root, 'CREDITS.md'), join(copy, 'CREDITS.md'))
        const applied = starterPackScript(['--root', copy, '--apply', path])
        expect(applied.status, applied.output).toBe(0)
        const list = Schema.decodeUnknownSync(StarterList)(
          JSON.parse(readFileSync(join(copy, 'starter', 'lines.json'), 'utf8')),
        )
        const line = list.lines.find(each => each.id === bridge.id)
        expect(line?.words[0]?.accentType).toBe(1)
        expect(line?.review).toMatchObject({
          verdict: 'correct',
          reviewedOn: saved.reviewedOn,
          accentType: 1,
          statedBefore: 2,
          note: 'sounds like 箸',
        })
        const checked = starterPackScript(['--check', '--root', copy])
        expect(checked.status, checked.output).toBe(0)
      } finally {
        rmSync(copy, { recursive: true, force: true })
      }

      nothingSent(requests, origin)
      expect(problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})
