import { Schema } from 'effect'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { syntheticTake } from '../../src/score/synthetic-take.ts'
import { encodeBackup } from '../../src/services/backup.ts'
import { compareTake } from '../../src/services/compare-take.ts'
import {
  NativeEntry,
  TakeEntry,
  TakeRecording,
  historyFormat,
  recordingId,
  storedRecordingOf,
} from '../../src/services/history-records.ts'
import { launch, withPage } from './take-session.ts'

// A line comes back, end to end in the built app: a blind take of the
// bundled line made nine days ago, restored from a backup, has the line
// due back a week after its day, listed on the home screen with no word
// of lateness; a guided take is not its return; a blind take with the
// fake microphone playing a right take is, and the line comes back three
// days later; its history charts both blind takes; nothing is sent.

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

const dayMs = 86_400_000

// The device's own day, as the app reckons it, `days` from now.
const localDay = (days: number): Date => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12)
}
const isoDay = (date: Date): string =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
const dayText = (date: Date): string =>
  date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

// A backup holding one blind take of the bundled line, made at noon on
// `taken`, that reached the threshold, through the app's own Schemas.
const plantedBackup = (taken: Date): Uint8Array => {
  const native = syntheticTake({
    pattern: [false, true, true, true],
    moraFrames: 9,
    registerHz: 220,
    spanSemitones: 6,
    seed: 1,
  })
  const take = syntheticTake({
    pattern: [false, true, true, true],
    moraFrames: 9,
    registerHz: 130,
    spanSemitones: 5,
    seed: 2,
  })
  const comparison = compareTake(native, take)
  const id = `${taken.getTime().toString(36)}-0000000000000001`
  const nativeId = recordingId(native)
  return encodeBackup(
    {
      settings: { keepTakeAudio: false },
      clips: [],
      natives: [
        Schema.decodeSync(NativeEntry)({
          format: historyFormat,
          id: nativeId,
          recording: storedRecordingOf(native),
        }),
      ],
      takes: [
        {
          entry: Schema.decodeSync(TakeEntry)({
            format: historyFormat,
            id,
            clipId: 'ame-ga-suki',
            lineId: '1',
            lineText: '雨が好き',
            mode: 'Blind',
            takenAt: taken.getTime(),
            day: isoDay(taken),
            nativeId,
            score:
              comparison.score._tag === 'Scored'
                ? { ...comparison.score, match: 0.82 }
                : comparison.score,
            audio: null,
          }),
          recording: Schema.decodeSync(TakeRecording)({
            format: historyFormat,
            id,
            take: storedRecordingOf(take),
            alignedF0: comparison.alignedTakeF0,
          }),
        },
      ],
      audio: new Map(),
    },
    taken.getTime() + dayMs,
  )
}

const record = async (page: Page, button: string): Promise<void> => {
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

test.describe('a line that comes back', () => {
  test('due a week late with no word of it, a guided take not its return, a blind one is, then charted, nothing sent', async ({
    playwright,
    baseURL,
  }) => {
    const nineDaysAgo = localDay(-9)
    const today = localDay(0)
    const inThreeDays = localDay(3)
    const browser = await launch(playwright, rightTake)
    try {
      await withPage(browser, async ({ page, requests, problems }) => {
        // Nothing has come back before any blind take.
        await page.goto('/')
        const due = page.getByRole('region', { name: 'Back for a blind take' })
        await expect(
          due.getByText(
            'No lines are due back today. A line you take blind comes back here on a later day, for another blind take.',
          ),
        ).toBeVisible()

        // A blind take nine days ago, from a backup.
        await page.goto('/settings')
        const choosing = page.waitForEvent('filechooser')
        await page
          .getByRole('button', { name: 'Restore from a backup' })
          .click()
        await (
          await choosing
        ).setFiles({
          name: 'intone-history-planted.zip',
          mimeType: 'application/zip',
          buffer: Buffer.from(plantedBackup(nineDaysAgo)),
        })
        await expect(
          page.getByText('Restored 1 take from the backup.'),
        ).toBeVisible({ timeout: 30_000 })

        // Due since eight days ago, and listed like any other.
        await page.goto('/')
        const row = due.getByRole('link', { name: /^雨が好き/ })
        await expect(row).toHaveAccessibleName(
          new RegExp(`last blind take ${dayText(nineDaysAgo)}`),
        )
        await expect(due.getByText('1 line due back today')).toBeVisible()
        await expect(
          page.getByText(/\b(overdue|late|missed|lost)\b/i),
        ).toHaveCount(0)
        await row.click()
        await expect(
          page.getByRole('heading', { name: 'Copy the line' }),
        ).toBeVisible({ timeout: 30_000 })
        await expect(
          page.getByText(
            'Due back today: record it blind, as only a blind take counts as its return.',
          ),
        ).toBeVisible()

        // A guided take is not its return.
        await record(page, 'Record')
        const status = page.getByRole('status').filter({
          hasText: 'match to this clip',
        })
        await expect(status).toContainText(
          'This line is due back: only a blind take counts as its return.',
        )

        // A blind take is, and the line comes back after the next step.
        await record(page, 'Record blind')
        await expect(
          page.getByRole('heading', { name: 'Your copy, blind' }),
        ).toBeVisible()
        await expect(status).toContainText(
          `This line comes back for a blind take on ${dayText(inThreeDays)}.`,
        )
        await expect(
          page.getByText(
            `Comes back for a blind take on ${dayText(inThreeDays)}.`,
            { exact: true },
          ),
        ).toBeVisible()

        // Home has none due now, and says when the next comes.
        await page.goto('/')
        await expect(
          due.getByText(
            `No lines are due back today. The next comes back on ${dayText(inThreeDays)}.`,
          ),
        ).toBeVisible()

        // The line's history charts both blind takes over time.
        await page.goto('/history/ame-ga-suki/1')
        await expect(
          page.getByRole('img', {
            name: new RegExp(
              `^Your blind takes of this line: 2 takes from ${dayText(nineDaysAgo)} to ${dayText(today)}: first 82%, latest \\d+%, best \\d+%\\. 2 of 2 reached the threshold of 75%\\.$`,
            ),
          }),
        ).toBeVisible()
        await expect(
          page.locator('[data-blind-chart] circle[data-reached="true"]'),
        ).toHaveCount(2)
        await expect(
          page.getByText(
            `Comes back for a blind take on ${dayText(inThreeDays)}.`,
            { exact: true },
          ),
        ).toBeVisible()

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
