import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { encodeWav } from '../../src/engine/audio/wav.ts'
import { type Session, launch, report, withPage } from './take-session.ts'

// Bringing a clip, in the built app: a LibriVox CC0 clip chosen or dropped
// is cut into lines on the device, kept across a reload, and a line of it
// practised with Chromium's fake microphone, scored as the bundled line
// is; a file the app cannot use is named and refused, a clip over ten
// minutes before it is decoded; a cut can be stopped, and a clip deleted
// with everything of it. Nothing is sent anywhere, and every format
// fixtures/formats/ holds is tried (docs/uploads.md).

const root = join(import.meta.dirname, '..', '..')
const clip = join(root, 'fixtures', 'real', 'gongitsune.wav')
const longerClip = join(root, 'fixtures', 'real', 'romandourou.wav')

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

// What the device keeps: the clip store's files, and the clips' records.
const onDevice = (page: Page) =>
  page.evaluate(async () => {
    const files: Array<string> = []
    const walk = async (
      directory: FileSystemDirectoryHandle,
      prefix: string,
    ): Promise<void> => {
      for await (const [name, handle] of directory.entries()) {
        if (handle instanceof FileSystemDirectoryHandle) {
          await walk(handle, `${prefix}${name}/`)
        } else {
          files.push(`${prefix}${name}`)
        }
      }
    }
    await walk(await navigator.storage.getDirectory(), '')
    const clips = await new Promise<number>(resolve => {
      const opening = indexedDB.open('intone')
      opening.onsuccess = () => {
        const database = opening.result
        if (!database.objectStoreNames.contains('clips')) {
          database.close()
          resolve(0)
          return
        }
        const counting = database
          .transaction('clips', 'readonly')
          .objectStore('clips')
          .count()
        counting.onsuccess = () => {
          database.close()
          resolve(counting.result)
        }
      }
    })
    return { files: files.sort(), clips }
  })

const chooseFile = (page: Page, path: string) =>
  page.locator('input[type="file"]').setInputFiles(path)

// Cuts `path` on /upload and waits for its lines.
const cut = async (page: Page, path: string): Promise<number> => {
  await page.goto('/upload')
  const started = Date.now()
  await chooseFile(page, path)
  await page.waitForURL(/\/level\//, { timeout: 120_000 })
  await expect(
    page.getByRole('heading', { name: 'Lines to copy' }),
  ).toBeVisible()
  return Date.now() - started
}

const lineRows = (page: Page) => page.getByRole('link', { name: /^Line \d+/ })

test('a CC0 clip is cut into lines, kept, and one practised with a scored take, nothing sent', async ({
  playwright,
  baseURL,
}, testInfo) => {
  test.setTimeout(240_000)
  // The take copies line 1 in the reader's own voice: the fake microphone
  // plays the clip from its start, where line 1 is.
  const browser = await launch(playwright, clip)
  try {
    await withPage(browser, async session => {
      const { page } = session
      await page.goto('/upload')
      await expect(
        page.getByText('Your clip stays on this device.', { exact: true }),
      ).toBeVisible()
      const milliseconds = await cut(page, clip)
      const lines = await lineRows(page).count()
      expect(lines).toBeGreaterThanOrEqual(6)
      expect(lines).toBeLessThanOrEqual(16)
      const lengths = await page.locator('[data-level-row]').evaluateAll(rows =>
        rows.map(row => {
          const seconds = /· (\d+\.\d) s/.exec(row.textContent ?? '')?.[1]
          return Number(seconds)
        }),
      )
      lengths.forEach(length => {
        expect(length).toBeGreaterThanOrEqual(0.8)
        expect(length).toBeLessThanOrEqual(4.5)
      })
      await report(testInfo, 'cut', { milliseconds, lines, lengths })

      // It is kept: after a reload, the home screen and its level list it.
      const kept = await onDevice(page)
      expect(kept.clips).toBe(1)
      expect(kept.files).toHaveLength(1)
      expect(kept.files[0]).toMatch(/^clips\/[A-Za-z0-9-]+\.wav$/)
      await page.goto('/')
      await page.reload()
      await page
        .getByRole('link', { name: /^gongitsune\.wav\b.*\d+ lines/ })
        .click()
      await expect(lineRows(page)).toHaveCount(lines)

      await lineRows(page).first().click()
      await expect(
        page.getByRole('heading', { name: 'Line 1', level: 1 }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Record' }).click()
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
      await expect(
        page.getByText('Kept in your history on this device.'),
      ).toBeVisible()
      await report(testInfo, 'score', {
        match: await page.getByText(/% match to this clip/).textContent(),
      })

      // Its history names the clip's line.
      await page.getByRole('link', { name: 'See this line’s history' }).click()
      await expect(
        page.getByRole('heading', { name: 'gongitsune.wav, line 1', level: 1 }),
      ).toBeVisible({ timeout: 30_000 })

      expectNothingSent(session, baseURL ?? '')
      expect(session.problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})

test('a clip is deleted with its lines and takes, only once confirmed', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  await withPage(browser, async session => {
    const { page } = session
    await cut(page, clip)
    await page.getByRole('button', { name: 'Delete this clip' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete gongitsune.wav?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Keep the clip' }).click()
    await expect(dialog).toBeHidden()
    expect((await onDevice(page)).clips).toBe(1)

    await page.getByRole('button', { name: 'Delete this clip' }).click()
    await dialog.getByRole('button', { name: 'Delete the clip' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('status').first()).toHaveText(
      'Deleted gongitsune.wav, with its lines and your takes of them.',
    )
    expect(await onDevice(page)).toStrictEqual({ files: [], clips: 0 })
    expectNothingSent(session, baseURL ?? '')
  })
})

test('a clip dropped on the page is cut as one chosen', async ({ browser }) => {
  test.setTimeout(120_000)
  await withPage(browser, async ({ page }) => {
    await page.goto('/upload')
    const bytes = [...readFileSync(clip)]
    const transfer = await page.evaluateHandle(content => {
      const data = new DataTransfer()
      data.items.add(
        new File([Uint8Array.from(content)], 'dropped.wav', {
          type: 'audio/wav',
        }),
      )
      return data
    }, bytes)
    const zone = page.locator('label').filter({ hasText: 'or drop one here' })
    await zone.dispatchEvent('dragenter', { dataTransfer: transfer })
    await zone.dispatchEvent('drop', { dataTransfer: transfer })
    await page.waitForURL(/\/level\//, { timeout: 120_000 })
    await expect(
      page.getByRole('heading', { name: 'dropped.wav', level: 1 }),
    ).toBeVisible()
  })
})

test('a file the app cannot use is named and refused, and one over ten minutes before it is decoded', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  await withPage(browser, async ({ page }) => {
    const workers: Array<string> = []
    page.on('worker', worker => workers.push(worker.url()))
    await page.goto('/upload')

    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not audio'),
    })
    await expect(page.getByRole('alert')).toHaveText(
      'notes.txt could not be used. It is not an audio file. Choose a recording, such as a WAV, MP3 or M4A file.',
    )

    await page.locator('input[type="file"]').setInputFiles({
      name: 'broken.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.alloc(4096, 7),
    })
    await expect(page.getByRole('alert')).toHaveText(
      /^broken\.mp3 could not be used\. This browser cannot (play|decode) it\. Convert it to WAV, MP3 or M4A and try again\.$/,
      { timeout: 30_000 },
    )

    // Ten minutes and a second of quiet at 8 kHz: its header says how
    // long it is, so it is refused unread.
    const long = encodeWav({
      sampleRate: 8000,
      encoding: 'pcm16',
      channels: [new Float32Array(601 * 8000)],
    })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'long.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from(long),
    })
    await expect(page.getByRole('alert')).toHaveText(
      'long.wav could not be used. It is 10:01 long, and a clip can be at most 10 minutes. Cut it shorter first.',
      { timeout: 30_000 },
    )
    expect(workers.filter(url => /clip\.worker/.test(url))).toStrictEqual([])
    expect((await onDevice(page)).clips).toBe(0)
  })
})

test('a cut can be stopped, which ends its Worker and keeps nothing', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  await withPage(browser, async ({ page }) => {
    const ended: Array<string> = []
    page.on('worker', worker => {
      worker.on('close', () => ended.push(worker.url()))
    })
    await page.goto('/upload')
    await chooseFile(page, longerClip)
    await expect(page.getByText(/^Finding where each line starts/)).toBeVisible(
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByRole('status')).toHaveText(
      'Stopped. Nothing of romandourou.wav was kept.',
    )
    await expect
      .poll(() => ended.some(url => /clip\.worker/.test(url)))
      .toBe(true)
    expect(await onDevice(page)).toStrictEqual({ files: [], clips: 0 })
    await expect(page.locator('input[type="file"]')).toBeAttached()
  })
})

const formats: {
  formats: ReadonlyArray<{ file: string; what: string }>
} = JSON.parse(
  readFileSync(join(root, 'fixtures', 'formats', 'formats.json'), 'utf8'),
)

// What Chromium decodes, as docs/uploads.md records it.
const decodesInChromium = new Set([
  'pcm16.wav',
  'pcm24.wav',
  'float32.wav',
  'mp3.mp3',
  'aac.m4a',
  'flac.flac',
  'vorbis.ogg',
  'opus.ogg',
  'opus.webm',
])

test('each format is cut or refused by name, as docs/uploads.md says', async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  const results: Array<{ file: string; what: string; lines: number | string }> =
    []
  await withPage(browser, async ({ page }) => {
    for (const { file, what } of formats.formats) {
      await page.goto('/upload')
      await chooseFile(page, join(root, 'fixtures', 'formats', file))
      const outcome = await Promise.race([
        page.waitForURL(/\/level\//, { timeout: 60_000 }).then(() => 'cut'),
        page
          .getByRole('alert')
          .waitFor({ timeout: 60_000 })
          .then(() => 'refused'),
      ])
      if (outcome === 'cut') {
        await expect(
          page.getByRole('heading', { name: 'Lines to copy' }),
        ).toBeVisible()
        results.push({ file, what, lines: await lineRows(page).count() })
      } else {
        const said = (await page.getByRole('alert').textContent()) ?? ''
        expect(said.startsWith(`${file} could not be used.`)).toBe(true)
        results.push({ file, what, lines: said })
      }
    }
  })
  await report(testInfo, 'formats', results)
  expect(
    results
      .filter(({ lines }) => typeof lines === 'number' && lines > 0)
      .map(({ file }) => file)
      .sort(),
  ).toStrictEqual([...decodesInChromium].sort())
})
