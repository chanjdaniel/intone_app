import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import {
  generateHistory,
  generatedBackup,
  historyFixture,
} from '../support/history-fixture.ts'
import {
  type Session,
  launch,
  openLine,
  report,
  withPage,
} from './take-session.ts'

// History on the device, end to end in the built app: each take kept in
// IndexedDB and shown on /history and its line's page; the take's audio
// kept in the origin private file system only once the learner turns it
// on, and deleted with everything else; the backup saved, refused when
// malformed, and restored; a database from before history upgraded; the
// history screens at 5,000 takes; Safari's note; and nothing of it ever
// sent anywhere.

const voices = join(import.meta.dirname, '..', '..', 'fixtures', 'voices')
const rightTake = join(voices, 'ame-ga-suki', 'kurono-takehiro', 'right.wav')

// Records one take of the bundled line, to its score.
const recordTake = async (page: Page, first: boolean) => {
  await page
    .getByRole('button', {
      name: first ? 'Record' : 'Record again',
      exact: true,
    })
    .click()
  await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('timer')).toHaveText(/^0:02 of 0:30$/, {
    timeout: 10_000,
  })
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Your copy' })).toBeVisible({
    timeout: 30_000,
  })
}

// What the page keeps: the history's takes, and every file in the origin
// private file system with its size.
const kept = (page: Page) =>
  page.evaluate(async () => {
    const takes = await new Promise<number>((resolve, reject) => {
      const opening = indexedDB.open('intone')
      opening.onsuccess = () => {
        const database = opening.result
        if (!database.objectStoreNames.contains('takes')) {
          database.close()
          resolve(0)
          return
        }
        const counting = database
          .transaction('takes', 'readonly')
          .objectStore('takes')
          .count()
        counting.onsuccess = () => {
          database.close()
          resolve(counting.result)
        }
        counting.onerror = () => reject(counting.error)
      }
      opening.onerror = () => reject(opening.error)
    })
    const files: Array<{ path: string; size: number }> = []
    const walk = async (
      folder: FileSystemDirectoryHandle,
      prefix: string,
    ): Promise<void> => {
      for await (const [name, handle] of folder.entries()) {
        if (handle.kind === 'directory') {
          await walk(handle, `${prefix}${name}/`)
        } else {
          files.push({
            path: `${prefix}${name}`,
            size: (await handle.getFile()).size,
          })
        }
      }
    }
    await walk(await navigator.storage.getDirectory(), '')
    return { takes, files }
  })

// Every request the session made stayed on the app's origin, read
// nothing with a body, and sent nothing.
const expectNothingSent = (session: Session, baseURL: string) => {
  const origin = new URL(baseURL).origin
  const elsewhere = session.requests.filter(
    request =>
      !request.url.startsWith(`${origin}/`) &&
      !request.url.startsWith(`blob:${origin}/`),
  )
  expect(elsewhere).toStrictEqual([])
  expect(
    session.requests.filter(
      request => request.method !== 'GET' || request.body !== null,
    ),
  ).toStrictEqual([])
}

// Turns kept audio on, and waits until the device has the setting.
const keepAudio = async (page: Page) => {
  await page.goto('/settings')
  const checkbox = page.getByRole('checkbox', {
    name: 'Keep the recording of each take',
  })
  await expect(checkbox).not.toBeChecked()
  await checkbox.check()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise(resolve => {
            const opening = indexedDB.open('intone')
            opening.onsuccess = () => {
              const reading = opening.result
                .transaction('meta', 'readonly')
                .objectStore('meta')
                .get('settings')
              reading.onsuccess = () => {
                opening.result.close()
                resolve(reading.result)
              }
            }
          }),
      ),
    )
    .toStrictEqual({ keepTakeAudio: true })
}

const clearAll = async (page: Page) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Clear all data…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete everything?' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Keep everything' }),
  ).toBeFocused()
  await dialog.getByRole('button', { name: 'Delete everything' }).click()
  await expect(page.getByRole('status').first()).toHaveText(
    /^Everything Intone kept on this device is deleted/,
  )
  await expect(dialog).toBeHidden()
}

test.describe('history on the device', () => {
  test('keeps each take with its curves and score, shows it in the history, and sends nothing anywhere', async ({
    playwright,
    baseURL,
  }) => {
    const browser = await launch(playwright, rightTake)
    try {
      await withPage(browser, async session => {
        const { page, problems } = session
        await openLine(page)
        await recordTake(page, true)
        await expect(
          page.getByText('Kept in your history on this device.'),
        ).toBeVisible()
        expect(await kept(page)).toStrictEqual({ takes: 1, files: [] })

        await page
          .getByRole('link', { name: 'See this line’s history' })
          .click()
        await expect(
          page.getByRole('heading', { name: '雨が好き', level: 1 }),
        ).toBeVisible()
        await expect(page.getByText('1 take since')).toBeVisible()
        await expect(
          page.getByRole('heading', {
            name: 'First, best and latest take',
            level: 3,
          }),
        ).toBeVisible()
        await expect(
          page.getByText('Scored by version 1 of the score.'),
        ).toBeVisible()
        await expect(
          page.getByRole('img', { name: /^Your pitch curve, lined up/ }),
        ).toHaveAttribute('data-drawn-frames', /^[1-9]/)

        await page.getByRole('link', { name: 'Your history' }).click()
        await expect(
          page.getByRole('link', { name: /^雨が好き ?, 1 take · best \d+%/ }),
        ).toBeVisible()
        await expect(page.getByText('1 day practised, 1 take')).toBeVisible()

        await page.goto('/settings')
        await expect(
          page.getByText(
            await page.evaluate(async () =>
              (await navigator.storage.persisted())
                ? 'The browser has agreed to keep Intone’s storage'
                : 'The browser has not agreed to keep Intone’s storage',
            ),
          ),
        ).toBeVisible()
        expect(problems).toStrictEqual([])
        expectNothingSent(session, baseURL ?? '')
      })
    } finally {
      await browser.close()
    }
  })

  test('keeps a take’s audio only once it is turned on, and deletes everything when asked', async ({
    playwright,
    baseURL,
  }) => {
    const browser = await launch(playwright, rightTake)
    try {
      await withPage(browser, async session => {
        const { page, problems } = session
        await keepAudio(page)
        await openLine(page)
        await recordTake(page, true)
        await expect(
          page.getByText('Kept in your history on this device.'),
        ).toBeVisible()
        const withAudio = await kept(page)
        expect(withAudio.takes).toBe(1)
        expect(withAudio.files).toHaveLength(1)
        const file = withAudio.files[0]
        expect(file?.path).toMatch(/^takes\/[0-9a-z]+-[0-9a-f]{16}\.wav$/)
        // About two seconds of 16-bit audio at the capture's rate.
        expect(file?.size).toBeGreaterThan(2 * 2 * 44_100)

        await page.goto('/settings')
        await expect(
          page.getByText('1 take has its recording kept.'),
        ).toBeVisible()
        await clearAll(page)
        expect(await kept(page)).toStrictEqual({ takes: 0, files: [] })
        await expect(
          page.getByRole('checkbox', {
            name: 'Keep the recording of each take',
          }),
        ).not.toBeChecked()
        await page.goto('/history')
        await expect(page.getByText(/^No takes yet\./)).toBeVisible()
        expect(problems).toStrictEqual([])
        expectNothingSent(session, baseURL ?? '')
      })
    } finally {
      await browser.close()
    }
  })

  test('saves a backup, refuses a file that is not one, and restores it whole, audio included', async ({
    playwright,
    baseURL,
  }) => {
    const browser = await launch(playwright, rightTake)
    const scratch = mkdtempSync(join(tmpdir(), 'intone-backup-'))
    try {
      await withPage(browser, async session => {
        const { page, problems } = session
        await keepAudio(page)
        await openLine(page)
        await recordTake(page, true)
        await recordTake(page, false)
        const before = await kept(page)
        expect(before.takes).toBe(2)

        await page.goto('/settings')
        await page
          .getByRole('checkbox', {
            name: 'Include the recordings (2 takes)',
          })
          .check()
        const downloading = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Save a backup' }).click()
        const download = await downloading
        expect(download.suggestedFilename()).toMatch(
          /^intone-history-\d{4}-\d{2}-\d{2}\.zip$/,
        )
        const backup = join(scratch, download.suggestedFilename())
        await download.saveAs(backup)
        await expect(
          page.getByText(/^Saved intone-history-.*, with 2 takes\.$/),
        ).toBeVisible()

        await clearAll(page)
        expect(await kept(page)).toStrictEqual({ takes: 0, files: [] })

        const notBackup = join(scratch, 'notes.zip')
        writeFileSync(notBackup, 'not a backup')
        const choosingWrong = page.waitForEvent('filechooser')
        await page
          .getByRole('button', { name: 'Restore from a backup' })
          .click()
        await (await choosingWrong).setFiles(notBackup)
        await expect(
          page.getByText(
            'Nothing was restored. This file is not an Intone backup this app can read: it is not a zip file.',
          ),
        ).toBeVisible()
        expect(await kept(page)).toStrictEqual({ takes: 0, files: [] })

        const choosing = page.waitForEvent('filechooser')
        await page
          .getByRole('button', { name: 'Restore from a backup' })
          .click()
        await (await choosing).setFiles(backup)
        await expect(
          page.getByText('Restored 2 takes from the backup.'),
        ).toBeVisible()
        expect(await kept(page)).toStrictEqual(before)
        await page.goto('/history/ame-ga-suki/1')
        await expect(page.getByText('2 takes since')).toBeVisible()

        expect(readFileSync(backup).subarray(0, 2).toString()).toBe('PK')
        expect(problems).toStrictEqual([])
        expectNothingSent(session, baseURL ?? '')
      })
    } finally {
      rmSync(scratch, { recursive: true, force: true })
      await browser.close()
    }
  })

  test('upgrades a database from before history, keeping the lines’ curves', async ({
    page,
  }) => {
    // A page with no use for the database, so the app leaves it alone.
    await page.goto('/no-such-page')
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const opening = indexedDB.open('intone', 1)
          opening.onupgradeneeded = () =>
            opening.result.createObjectStore('nativeCurves')
          opening.onsuccess = () => {
            const writing = opening.result.transaction(
              'nativeCurves',
              'readwrite',
            )
            writing.objectStore('nativeCurves').put({ planted: true }, 'line')
            writing.oncomplete = () => {
              opening.result.close()
              resolve()
            }
            writing.onerror = () => reject(writing.error)
          }
          opening.onerror = () => reject(opening.error)
        }),
    )
    await page.goto('/history')
    await expect(page.getByText(/^No takes yet\./)).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const opening = indexedDB.open('intone')
            opening.onsuccess = () => {
              const database = opening.result
              const reading = database.transaction(
                ['nativeCurves', 'meta'],
                'readonly',
              )
              const curve = reading.objectStore('nativeCurves').get('line')
              const format = reading.objectStore('meta').get('format')
              reading.oncomplete = () => {
                database.close()
                resolve({
                  version: database.version,
                  curve: curve.result,
                  format: format.result,
                  stores: [...database.objectStoreNames].sort(),
                })
              }
            }
            opening.onerror = () => reject(opening.error)
          }),
      ),
    ).toStrictEqual({
      version: 3,
      curve: { planted: true },
      format: { format: 1 },
      stores: [
        'clips',
        'meta',
        'nativeCurves',
        'natives',
        'takeRecordings',
        'takes',
      ],
    })
  })

  test('on Safari, the settings suggest the Home Screen and say why', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    })
    try {
      const page = await context.newPage()
      await page.goto('/settings')
      await expect(
        page.getByRole('heading', { name: 'On Safari' }),
      ).toBeVisible()
      await expect(
        page.getByText(
          /^Safari deletes what a site keeps after seven days without a visit/,
        ),
      ).toBeVisible()
      // Added to the Home Screen, the page opens as an app of its own.
      expect(
        await page.evaluate(async () => {
          const link = document.querySelector('link[rel="manifest"]')
          const href = link?.getAttribute('href') ?? ''
          const manifest: unknown = await (await fetch(href)).json()
          return manifest
        }),
      ).toMatchObject({ display: 'standalone', start_url: '/', scope: '/' })
    } finally {
      await context.close()
    }
  })
})

// How long the history screens may take with 5,000 takes kept, from the
// address to the screen drawn, on the machine and in CI
// (docs/history.md, "At scale").
const historyWithin = 3_000
const lineHistoryWithin = 3_000

test.describe('history at 5,000 takes', () => {
  test.setTimeout(240_000)

  test('restores them from a backup, and draws /history and the busiest line’s history in time', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const history = generateHistory()
    const scratch = mkdtempSync(join(tmpdir(), 'intone-history-'))
    const backup = join(scratch, 'intone-history-generated.zip')
    writeFileSync(backup, generatedBackup(history))
    try {
      await withPage(browser, async session => {
        const { page, problems } = session
        await page.goto('/settings')
        const restoreStart = Date.now()
        const choosing = page.waitForEvent('filechooser')
        await page
          .getByRole('button', { name: 'Restore from a backup' })
          .click()
        await (await choosing).setFiles(backup)
        await expect(
          page.getByText(
            `Restored ${historyFixture.takes.toLocaleString('en-GB')} takes from the backup.`,
          ),
        ).toBeVisible({ timeout: 120_000 })
        const restoreMs = Date.now() - restoreStart

        const historyStart = Date.now()
        await page.goto('/history')
        await expect(
          page.getByText(`${historyFixture.lines} lines practised`),
        ).toBeVisible({ timeout: 30_000 })
        await expect(
          page.getByRole('link', { name: /takes? · best/ }),
        ).toHaveCount(50)
        const historyMs = Date.now() - historyStart

        const lineStart = Date.now()
        await page.goto(
          `/history/${history.favourite.clipId}/${history.favourite.lineId}`,
        )
        const curves = page.getByRole('img', { name: /^Your pitch curve/ })
        await expect(curves.first()).toHaveAttribute(
          'data-drawn-frames',
          /^[1-9]/,
          {
            timeout: 30_000,
          },
        )
        await expect(
          page.getByRole('img', {
            name: new RegExp(
              `^Your match over ${(historyFixture.takes / historyFixture.favouriteEvery).toLocaleString('en-GB')} takes`,
            ),
          }),
        ).toBeVisible()
        const lineHistoryMs = Date.now() - lineStart

        const usage = await page.evaluate(
          async () => (await navigator.storage.estimate()).usage ?? 0,
        )
        await report(testInfo, 'history-at-scale', {
          takes: historyFixture.takes,
          backupBytes: readFileSync(backup).length,
          restoreMs,
          historyMs,
          lineHistoryMs,
          storageUsedBytes: usage,
        })
        expect(historyMs).toBeLessThan(historyWithin)
        expect(lineHistoryMs).toBeLessThan(lineHistoryWithin)
        expect(problems).toStrictEqual([])
        expectNothingSent(session, baseURL ?? '')
      })
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
