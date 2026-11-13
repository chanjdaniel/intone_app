import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import {
  modelDirectory,
  readModelList,
  servedModelFiles,
} from '../../build/models.ts'
import { type Session, launch, report, withPage } from './take-session.ts'
import { declineTextModel } from './text-offer.ts'

// The text of a clip the learner brings, in the built app: the download
// is offered with its size and nothing downloads before the learner
// agrees; then Whisper base writes the CC0 clip out in a Worker, its text
// matched to the lines, and every model file is fetched once; after a
// reload a second transcription fetches no model file at all, from the
// browser cache Transformers.js keeps; a line's own text is typed and
// kept; once the files are gone, the download is asked again with its
// size; a line of the clip is copied to a score while the download is
// held under way, so practice never waits for the text; and nothing
// leaves the device: no request to another origin, and none with a body.
// Declining leaves the clip's lines to practise, as uploads.spec.ts shows
// with a scored take after "Not now".

const root = join(import.meta.dirname, '..', '..')
const clip = join(root, 'fixtures', 'real', 'gongitsune.wav')

const expectNothingSent = (session: Session, baseURL: string) => {
  const origin = new URL(baseURL).origin
  expect(
    session.requests.filter(
      request =>
        !request.url.startsWith(`${origin}/`) &&
        !request.url.startsWith(`blob:${origin}/`),
    ),
  ).toStrictEqual([])
  expect(
    session.requests.filter(
      request => request.method !== 'GET' || request.body !== null,
    ),
  ).toStrictEqual([])
}

const whisperBase = async () => {
  const models = await readModelList(join(root, 'models.json'))
  const model = models.find(each => each.id === 'whisper-base')
  if (model === undefined) {
    throw new Error('models.json lists no whisper-base')
  }
  return {
    directory: `/${modelDirectory(model)}`,
    paths: servedModelFiles([model]).map(({ path }) => `/${path}`),
    megabytes: Math.round(
      model.files.reduce((sum, file) => sum + file.bytes, 0) / 1_000_000,
    ),
  }
}

// The requests for any text model's files, by path.
const modelRequests = (session: Session, from = 0) =>
  session.requests
    .slice(from)
    .map(request => new URL(request.url).pathname)
    .filter(path => /^\/models\/whisper-/.test(path))

const lineTitles = (page: Page) =>
  page
    .locator('[data-level-row]')
    .evaluateAll(rows =>
      rows.map(row => row.querySelector('span span')?.textContent ?? ''),
    )

// When the clip's transcript was kept, as the device holds it.
const transcriptAt = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number | null>(resolve => {
        const opening = indexedDB.open('intone')
        opening.onsuccess = () => {
          const reading = opening.result
            .transaction('clips', 'readonly')
            .objectStore('clips')
            .getAll()
          reading.onsuccess = () => {
            opening.result.close()
            const [clip]: Array<unknown> = reading.result
            const at: unknown =
              typeof clip === 'object' && clip !== null && 'transcript' in clip
                ? Reflect.get(Object(clip.transcript), 'at')
                : null
            resolve(typeof at === 'number' ? at : null)
          }
        }
      }),
  )

const written = (page: Page) =>
  expect(
    page.getByText(/^Written out on this device by Whisper base\./),
  ).toBeVisible({ timeout: 240_000 })

test('a CC0 clip is written out on the device once the learner agrees, each model file fetched once, and none again after a reload', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000)
  const model = await whisperBase()
  await withPage(browser, async session => {
    const { page } = session
    await page.goto('/upload')
    await page.locator('#upload-file').setInputFiles(clip)
    await page.waitForURL(/\/level\//, { timeout: 120_000 })

    const dialog = page.getByRole('dialog', {
      name: 'Download the text model?',
    })
    await expect(dialog).toContainText(
      `It needs a one-time download of ${model.megabytes} MB, which the browser keeps. Your clip never leaves this device.`,
    )
    // Nothing of the model is fetched before the learner agrees.
    expect(modelRequests(session)).toStrictEqual([])
    const started = Date.now()
    await dialog
      .getByRole('button', { name: `Download ${model.megabytes} MB` })
      .click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('progressbar')).toBeVisible()
    await written(page)
    const firstMilliseconds = Date.now() - started

    // Each file of whisper-base, once, and nothing of whisper-small.
    expect(modelRequests(session).slice().sort()).toStrictEqual(
      model.paths.slice().sort(),
    )
    const titles = await lineTitles(page)
    const withText = titles.filter(title => !/^Line \d+$/.test(title))
    expect(withText.length).toBeGreaterThanOrEqual(titles.length - 1)
    // Words of ごんぎつね's first lines, in the order read.
    const all = withText.join('')
    expect(all).toMatch(/中山.*お城.*山の中/)
    expect(titles[0]).toMatch(/^昔/)

    // A line's own text, typed and kept across a reload.
    await page.getByRole('button', { name: 'Edit line 2’s text' }).click()
    const field = page.getByLabel('Line 2’s text', { exact: true })
    await expect(field).toBeFocused()
    await field.fill('中山という所に小さなお城があって')
    await page.getByRole('button', { name: 'Keep the text' }).click()
    await expect(field).toHaveCount(0)

    // After a reload, the text again, from the browser's cache: no model
    // file is fetched.
    const beforeReload = session.requests.length
    await page.reload()
    await expect(
      page.getByRole('link', {
        name: /^中山という所に小さなお城があって\s*, Line 2/,
      }),
    ).toBeVisible()
    const firstAt = await transcriptAt(page)
    const again = Date.now()
    await page.getByRole('button', { name: 'Write out the text again' }).click()
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
    await expect
      .poll(() => transcriptAt(page), { timeout: 240_000 })
      .not.toBe(firstAt)
    const secondMilliseconds = Date.now() - again
    expect(modelRequests(session, beforeReload)).toStrictEqual([])
    // The learner's own text stands over the transcript's.
    await expect(
      page.getByRole('link', {
        name: /^中山という所に小さなお城があって\s*, Line 2/,
      }),
    ).toBeVisible()
    const cached = await page.evaluate(async () => {
      const cache = await caches.open('intone-text-models')
      return (await cache.keys()).map(request => new URL(request.url).pathname)
    })
    expect(cached.slice().sort()).toStrictEqual(model.paths.slice().sort())

    // The answer kept, but the model's files gone, as after a backup
    // restored on another device or a store the browser evicted: writing
    // the clip out offers the download again, with its size, and fetches
    // nothing before the learner agrees.
    await page.evaluate(() => caches.delete('intone-text-models'))
    const beforeEviction = session.requests.length
    await page.reload()
    await page.getByRole('button', { name: 'Write out the text again' }).click()
    await expect(dialog).toContainText(
      `It needs a one-time download of ${model.megabytes} MB, which the browser keeps. Your clip never leaves this device.`,
    )
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(modelRequests(session, beforeEviction)).toStrictEqual([])

    expectNothingSent(session, baseURL ?? '')
    expect(session.problems).toStrictEqual([])
    await report(testInfo, 'transcription', {
      firstMilliseconds,
      secondMilliseconds,
      lines: titles.length,
      titles,
    })
  })
})

test('“Not now” downloads nothing, is kept, and the settings offer the download again', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000)
  await withPage(browser, async session => {
    const { page } = session
    await page.goto('/upload')
    await page.locator('#upload-file').setInputFiles(clip)
    await page.waitForURL(/\/level\//, { timeout: 120_000 })
    // Enter on the larger model's checkbox only ticks or reads it: in
    // Chromium it would submit a form with a submit button, which would
    // start the download unasked (frontend patterns, "Dialog sizes").
    const dialog = page.getByRole('dialog', {
      name: 'Download the text model?',
    })
    await dialog.getByRole('checkbox').focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('progressbar')).toHaveCount(0)
    await declineTextModel(page)
    await expect(
      page.getByRole('button', { name: 'Paste your own text' }),
    ).toBeVisible()

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Lines to copy' }),
    ).toBeVisible()
    await page.goto('/settings')
    await expect(
      page.getByText(
        'You said not now to the text model’s download, so your clips are not written out. You can still type or paste their text.',
      ),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Download the text model' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Download the text model?' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Not now' }).click()

    expect(modelRequests(session)).toStrictEqual([])
    expectNothingSent(session, baseURL ?? '')
    expect(session.problems).toStrictEqual([])
  })
})

test('practice never waits for the text: a line of the clip is copied to a score while its download is under way', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(240_000)
  const model = await whisperBase()
  // The take copies line 1 in the reader's own voice: the fake microphone
  // plays the clip from its start, where line 1 is.
  const browser = await launch(playwright, clip)
  try {
    await withPage(browser, async session => {
      const { page, context } = session
      // The model's weights are held back until the take is scored, so the
      // job is still downloading the whole time.
      const held: { release: () => void } = { release: () => {} }
      const released = new Promise<void>(resolve => {
        held.release = resolve
      })
      await context.route(
        url => /^\/models\/whisper-base\/.+\.onnx$/.test(url.pathname),
        async route => {
          await released
          await route.abort()
        },
      )
      await page.goto('/upload')
      await page.locator('#upload-file').setInputFiles(clip)
      await page.waitForURL(/\/level\//, { timeout: 120_000 })
      await page
        .getByRole('dialog', { name: 'Download the text model?' })
        .getByRole('button', { name: `Download ${model.megabytes} MB` })
        .click()
      await expect(page.getByText(/^Downloading the text model:/)).toBeVisible()

      await page
        .getByRole('link', { name: /^Line 1\b/ })
        .first()
        .click()
      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Recording' }),
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('timer')).toHaveText(/^0:0[4-9]/, {
        timeout: 30_000,
      })
      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(page.getByText(/% match to this clip/)).toBeVisible({
        timeout: 30_000,
      })

      // The job ran on through it, still downloading.
      await page.getByRole('link', { name: /This level’s lines/ }).click()
      await expect(page.getByText(/^Downloading the text model:/)).toBeVisible()
      held.release()

      expectNothingSent(session, baseURL ?? '')
    })
  } finally {
    await browser.close()
  }
})
