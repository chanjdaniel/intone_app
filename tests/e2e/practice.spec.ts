import { join } from 'node:path'

import { type Locator, type Page, expect, test } from '@playwright/test'

import {
  launch,
  linePath,
  openLine,
  report,
  trackStates,
  withPage,
} from './take-session.ts'

// Copying the bundled line in the built app, end to end: the line's
// native curve tracked once and kept on the device, the line played
// before the microphone opens, a take of the same line in another voice
// drawn over it and scored against it, and both voices heard again,
// whole and at the stretch where they differed most.

const voices = join(import.meta.dirname, '..', '..', 'fixtures', 'voices')
// 雨が好き in 玄野武宏, a low voice, an octave and more below the line's
// 冥鳴ひまり: with its right accent, and with its fall moved (あめ↓が).
const takeOf = (variant: 'right' | 'fall-moved'): string =>
  join(voices, 'ame-ga-suki', 'kurono-takehiro', `${variant}.wav`)
const rightTake = takeOf('right')

// The colours in src/app/styles.css: the native's band, and the ramp
// from close to far.
const nativeColour = [0x8b, 0x93, 0xa0] as const
const ramp = [
  [0x2b, 0x5f, 0xc0],
  [0x73, 0x4d, 0xbb],
  [0x9e, 0x3e, 0x99],
  [0xba, 0x36, 0x63],
  [0xc2, 0x41, 0x0c],
] as const

// How many solid pixels of a canvas are nearest each of `colours`.
const countColours = (
  canvas: Locator,
  colours: ReadonlyArray<readonly [number, number, number]>,
): Promise<Array<number>> =>
  canvas.evaluate((element, palette) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error('not a canvas')
    }
    const context = element.getContext('2d')
    if (context === null) {
      throw new Error('no 2D context')
    }
    const { data } = context.getImageData(0, 0, element.width, element.height)
    const counts = palette.map(() => 0)
    for (let at = 0; at < data.length; at += 4) {
      if ((data[at + 3] ?? 0) < 250) {
        continue
      }
      const distances = palette.map(
        ([red, green, blue]) =>
          Math.abs((data[at] ?? 0) - red) +
          Math.abs((data[at + 1] ?? 0) - green) +
          Math.abs((data[at + 2] ?? 0) - blue),
      )
      const nearest = distances.indexOf(Math.min(...distances))
      if ((distances[nearest] ?? 999) < 40) {
        counts[nearest] = (counts[nearest] ?? 0) + 1
      }
    }
    return counts
  }, colours)

const lineCanvas = (page: Page) =>
  page.getByRole('img', { name: /^The line's pitch curve/ })

// The score the result screen shows, read off its words: the match and
// each part, in percent.
const readScore = async (page: Page) => {
  const said = (await page.getByRole('status').textContent()) ?? ''
  const percentAfter = (pattern: RegExp): number =>
    Number(pattern.exec(said)?.[1] ?? Number.NaN)
  return {
    said,
    match: percentAfter(/(\d+)% match to this clip/),
    pitchAccent: percentAfter(/Pitch accent(\d+)%/),
    timing: percentAfter(/Timing(\d+)%/),
  }
}

// Records `wav` as a take of the line, checking the line plays before
// the microphone opens and both curves are drawn: how many of the take's
// pixels are on each step of the ramp, and whether every request stayed
// on the app's origin with no body.
const copyLine = async (
  playwright: Parameters<typeof launch>[0],
  wav: string,
  baseURL: string | undefined,
) => {
  const browser = await launch(playwright, wav)
  try {
    return await withPage(browser, async ({ page, requests, problems }) => {
      await openLine(page)
      const native = await countColours(lineCanvas(page), [nativeColour])
      expect(native[0]).toBeGreaterThan(2000)

      await page.getByRole('button', { name: 'Record', exact: true }).click()
      // The line plays first; the microphone is not open while it does.
      await expect(
        page.getByRole('heading', { name: 'Listen to the line' }),
      ).toBeVisible()
      expect(await trackStates(page)).toStrictEqual([])
      await expect(
        page.getByRole('heading', { name: 'Recording' }),
      ).toBeVisible({ timeout: 30_000 })
      expect(await trackStates(page)).toStrictEqual(['live'])
      const live = page.getByRole('img', {
        name: /^Your pitch, drawn as you speak over the line's/,
      })
      await expect(live).toHaveAttribute('data-drawn-last-voiced', /^[1-9]/, {
        timeout: 10_000,
      })
      await expect(page.getByRole('timer')).toHaveText(/^0:02 of 0:30$/, {
        timeout: 10_000,
      })
      // From the take's end, the press of stop, to its score on the
      // screen, timed inside the page by its own clock.
      await page.evaluate(() => {
        const timing = { stoppedAt: Number.NaN, shownAt: Number.NaN }
        Object.assign(window, { intoneResultTiming: timing })
        document.addEventListener(
          'click',
          event => {
            if (
              event.target instanceof Element &&
              event.target.closest('button')?.textContent?.includes('Stop')
            ) {
              timing.stoppedAt = performance.now()
            }
          },
          { capture: true },
        )
        new MutationObserver((_, observer) => {
          if (
            document
              .querySelector('[role="status"]')
              ?.textContent?.includes('match to this clip')
          ) {
            timing.shownAt = performance.now()
            observer.disconnect()
          }
        }).observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        })
      })
      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(page.getByText(/% match to this clip$/)).toBeVisible({
        timeout: 30_000,
      })
      const resultMs = await page.evaluate(() => {
        const timing = Reflect.get(window, 'intoneResultTiming')
        return timing.shownAt - timing.stoppedAt
      })
      await expect(
        page.getByRole('heading', { name: 'Your copy' }),
      ).toBeVisible()
      expect(await trackStates(page)).toStrictEqual(['ended'])
      const score = await readScore(page)

      const take = page.getByRole('img', {
        name: /^Your pitch curve, lined up with the line's/,
      })
      await expect(take).toHaveAttribute('data-span-seconds', /\d/)
      const steps = await countColours(take, ramp)
      const nativeAfter = await countColours(lineCanvas(page), [nativeColour])
      expect(nativeAfter[0]).toBeGreaterThan(2000)
      const drawn = steps.reduce((sum, count) => sum + count, 0)
      expect(drawn).toBeGreaterThan(1000)
      expect(problems).toStrictEqual([])
      return {
        score,
        resultMs,
        steps,
        drawn,
        // Within 2 semitones of the line, and 3 or more from it.
        closeShare: ((steps[0] ?? 0) + (steps[1] ?? 0)) / drawn,
        farShare: ((steps[3] ?? 0) + (steps[4] ?? 0)) / drawn,
        native: nativeAfter,
        private: requests.every(
          request =>
            request.url.startsWith(`${baseURL}/`) &&
            request.method === 'GET' &&
            request.body === null,
        ),
      }
    })
  } finally {
    await browser.close()
  }
}

test('a right take in another voice scores higher than a wrong one, drawn over the line, privately', async ({
  playwright,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000)
  const right = await copyLine(playwright, rightTake, baseURL)
  const wrong = await copyLine(playwright, takeOf('fall-moved'), baseURL)
  await report(testInfo, 'copies.json', { right, wrong })
  // The headline and its pitch accent part both put the right accent,
  // said by a voice an octave lower, above the fall moved one mora.
  expect(right.score.match).toBeGreaterThan(wrong.score.match)
  expect(right.score.pitchAccent).toBeGreaterThan(wrong.score.pitchAccent)
  expect(right.score.match).toBeGreaterThan(70)
  expect(right.score.said).toContain('The scale is provisional')
  // The right take, lined up with the line, is drawn mostly within 2
  // semitones of it and nowhere far; the wrong one is far where it
  // misses.
  expect(right.closeShare).toBeGreaterThan(0.8)
  expect(right.farShare).toBeLessThan(0.02)
  expect(wrong.closeShare).toBeLessThan(0.75)
  expect(wrong.farShare).toBeGreaterThan(0.1)
  expect(right.private).toBe(true)
  expect(wrong.private).toBe(true)
  // The time from the take's end to its score, on this desktop: tracking
  // the take in its Worker, then scoring it (docs/latency.md).
  for (const copy of [right, wrong]) {
    expect(copy.resultMs).toBeGreaterThan(0)
    expect(copy.resultMs).toBeLessThan(2000)
  }
})

// The names of the database's stores, and how many records each holds.
const storedOnDevice = (page: Page) =>
  page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('intone')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const names = Array.from(database.objectStoreNames)
    const counts = await Promise.all(
      names.map(
        name =>
          new Promise<number>(resolve => {
            const request = database.transaction(name).objectStore(name).count()
            request.onsuccess = () => resolve(request.result)
          }),
      ),
    )
    database.close()
    const files: Array<string> = []
    for await (const name of (await navigator.storage.getDirectory()).keys()) {
      files.push(name)
    }
    return {
      stores: Object.fromEntries(names.map((name, i) => [name, counts[i]])),
      localStorage: localStorage.length,
      files,
    }
  })

test('the native curve is tracked once, kept on the device, and tracked again if its record is damaged', async ({
  playwright,
}) => {
  test.setTimeout(90_000)
  const browser = await launch(playwright, rightTake)
  try {
    await withPage(browser, async ({ page, problems }) => {
      const workers: Array<string> = []
      page.on('worker', worker => workers.push(worker.url()))

      await openLine(page)
      expect(workers).toHaveLength(1)
      // The line's curve, and the history's format; no take yet.
      expect(await storedOnDevice(page)).toStrictEqual({
        stores: {
          clips: 0,
          meta: 1,
          nativeCurves: 1,
          natives: 0,
          takeRecordings: 0,
          takes: 0,
        },
        localStorage: 0,
        files: [],
      })

      await page.reload()
      await expect(
        page.getByRole('heading', { name: 'Copy the line' }),
      ).toBeVisible()
      await expect(lineCanvas(page)).toBeVisible()
      expect(workers).toHaveLength(1)

      // A record in an older or damaged shape reads as none.
      await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>(resolve => {
          const request = indexedDB.open('intone')
          request.onsuccess = () => resolve(request.result)
        })
        const store = database
          .transaction('nativeCurves', 'readwrite')
          .objectStore('nativeCurves')
        await new Promise<void>(resolve => {
          const keys = store.getAllKeys()
          keys.onsuccess = () => {
            keys.result.forEach(key => store.put({ format: 0 }, key))
            store.transaction.oncomplete = () => resolve()
          }
        })
        database.close()
      })
      await page.reload()
      await expect(
        page.getByRole('heading', { name: 'Copy the line' }),
      ).toBeVisible({ timeout: 30_000 })
      expect(workers).toHaveLength(2)

      // A take keeps its curves and score in the history (docs/history.md),
      // the native it was scored against once, and its audio nowhere: it
      // stays in memory until the learner turns kept audio on.
      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await expect(page.getByRole('timer')).toHaveText(/^0:01 of 0:30$/, {
        timeout: 30_000,
      })
      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(
        page.getByRole('button', { name: 'Record again' }),
      ).toBeVisible({ timeout: 30_000 })
      expect(await storedOnDevice(page)).toStrictEqual({
        stores: {
          clips: 0,
          meta: 1,
          nativeCurves: 1,
          natives: 1,
          takeRecordings: 1,
          takes: 1,
        },
        localStorage: 0,
        files: [],
      })
      expect(problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})

// How long a voice plays, from pressing its button to the button coming
// back.
const playFor = async (page: Page, button: Locator): Promise<number> => {
  const name = await button.textContent()
  await button.focus()
  const started = Date.now()
  await page.keyboard.press('Enter')
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  await expect(stop).toBeVisible()
  await expect(stop).toBeFocused()
  await expect(button).toHaveText(name ?? '', { timeout: 10_000 })
  return (Date.now() - started) / 1000
}

test('the line plays again slowed with its pitch kept, and the take plays from memory, by keyboard', async ({
  playwright,
}, testInfo) => {
  test.setTimeout(90_000)
  const browser = await launch(playwright, rightTake)
  try {
    await withPage(browser, async ({ page, problems }) => {
      await page.addInitScript(() => {
        const played: Array<{
          rate: number
          pitchKept: boolean
          seconds: number
        }> = []
        Object.assign(window, { intonePlayed: played })
        const play = HTMLMediaElement.prototype.play
        HTMLMediaElement.prototype.play = function () {
          const heard = {
            rate: this.playbackRate,
            pitchKept: this.preservesPitch,
            seconds: Number.NaN,
          }
          played.push(heard)
          const startedAt = performance.now()
          this.addEventListener(
            'ended',
            () => {
              heard.seconds = (performance.now() - startedAt) / 1000
            },
            { once: true },
          )
          return Reflect.apply(play, this, [])
        }
      })
      await page.goto('/')
      await page.getByRole('link', { name: /^Copy 雨が好き/ }).click()
      await expect(page).toHaveURL(new RegExp(`${linePath}$`))
      await expect(
        page.getByRole('heading', { name: 'Copy the line' }),
      ).toBeVisible({ timeout: 30_000 })

      const line = page.getByRole('button', {
        name: 'Hear the line',
        exact: true,
      })
      await playFor(page, line)
      const normal = page.getByRole('radio', { name: 'Normal speed' })
      await expect(normal).toBeChecked()
      await normal.focus()
      // Arrow keys move through the speeds, as radios do.
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await expect(
        page.getByRole('radio', { name: '0.5 times speed' }),
      ).toBeChecked()
      await playFor(page, line)

      await expect(
        page.getByRole('button', { name: 'Hear your take', exact: true }),
      ).toBeDisabled()
      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await expect(page.getByRole('timer')).toHaveText(/^0:02 of 0:30$/, {
        timeout: 30_000,
      })
      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(
        page.getByRole('heading', { name: 'Your copy' }),
      ).toBeVisible({ timeout: 30_000 })
      const takeSeconds = await playFor(
        page,
        page.getByRole('button', { name: 'Hear your take', exact: true }),
      )

      const played = await page.evaluate(
        (): ReadonlyArray<
          Readonly<{ rate: number; pitchKept: boolean; seconds: number }>
        > => Reflect.get(window, 'intonePlayed'),
      )
      await report(testInfo, 'listening.json', { takeSeconds, played })
      // Heard at its own speed, at half speed, then before the take at
      // its own speed again; its pitch kept every time.
      expect(
        played.map(({ rate, pitchKept }) => ({ rate, pitchKept })),
      ).toStrictEqual([
        { rate: 1, pitchKept: true },
        { rate: 0.5, pitchKept: true },
        { rate: 1, pitchKept: true },
      ])
      // The line is 1.27 s long, and at half speed lasts 1.27 s longer:
      // each play also waits a moment to start, the same both times.
      const [own, half] = played.map(({ seconds }) => seconds)
      expect(own).toBeGreaterThan(1.2)
      expect(own).toBeLessThan(1.6)
      expect((half ?? 0) - (own ?? 0)).toBeGreaterThan(1.15)
      expect((half ?? 0) - (own ?? 0)).toBeLessThan(1.4)
      // The take was recorded for about 2 s.
      expect(takeSeconds).toBeGreaterThan(1.5)
      expect(takeSeconds).toBeLessThan(4)
      expect(problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})

test('the worst stretch plays from the line by keyboard and from the take by touch, and the score is said once', async ({
  playwright,
}, testInfo) => {
  test.setTimeout(90_000)
  const browser = await launch(playwright, takeOf('fall-moved'))
  try {
    await withPage(
      browser,
      async ({ page, problems }) => {
        // Every play of the line, from where it started to when it was
        // paused, and every buffer of the take played.
        await page.addInitScript(() => {
          const lines: Array<{ from: number; seconds: number }> = []
          const takes: Array<number> = []
          Object.assign(window, { intoneLines: lines, intoneTakes: takes })
          const play = HTMLMediaElement.prototype.play
          HTMLMediaElement.prototype.play = function () {
            this.addEventListener(
              'playing',
              () => {
                const heard = { from: this.currentTime, seconds: Number.NaN }
                lines.push(heard)
                const startedAt = performance.now()
                const pause = this.pause.bind(this)
                this.pause = () => {
                  if (Number.isNaN(heard.seconds)) {
                    heard.seconds = (performance.now() - startedAt) / 1000
                  }
                  pause()
                }
              },
              { once: true },
            )
            return Reflect.apply(play, this, [])
          }
          const createBuffer = AudioContext.prototype.createBuffer
          AudioContext.prototype.createBuffer = function (
            channels: number,
            length: number,
            sampleRate: number,
          ) {
            takes.push(length / sampleRate)
            return Reflect.apply(createBuffer, this, [
              channels,
              length,
              sampleRate,
            ])
          }
        })
        await openLine(page)
        await page.getByRole('button', { name: 'Record', exact: true }).click()
        await expect(page.getByRole('timer')).toHaveText(/^0:02 of 0:30$/, {
          timeout: 30_000,
        })
        await page.getByRole('button', { name: 'Stop' }).click()
        await expect(page.getByText(/% match to this clip$/)).toBeVisible({
          timeout: 30_000,
        })

        // From here the live region must not change: the score is said
        // once, when it comes.
        const said = await page.getByRole('status').textContent()
        await page.evaluate(() => {
          const status = document.querySelector('[role="status"]')
          const changes = { count: 0, status }
          new MutationObserver(records => {
            changes.count += records.length
          }).observe(status ?? document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          })
          Object.assign(window, { intoneStatus: changes })
        })

        const where = await page
          .getByText(/^From \d\.\d\d s to \d\.\d\d s of the line/)
          .textContent()
        const [nativeFrom = Number.NaN, nativeTo = Number.NaN] = Array.from(
          (where ?? '').matchAll(/(\d\.\d\d) s/g),
          match => Number(match[1]),
        )
        expect(nativeTo - nativeFrom).toBeCloseTo(0.4, 1)

        const lineThere = page.getByRole('button', {
          name: 'Hear the line there',
        })
        await lineThere.focus()
        await page.keyboard.press('Enter')
        const stop = page.getByRole('button', { name: 'Stop', exact: true })
        await expect(stop).toBeFocused()
        await expect(lineThere).toBeVisible({ timeout: 10_000 })

        const takeThere = page.getByRole('button', {
          name: 'Hear your take there',
        })
        await takeThere.tap()
        await expect(stop).toBeVisible()
        await expect(takeThere).toBeVisible({ timeout: 10_000 })

        const heard = await page.evaluate(() => ({
          lines: Reflect.get(window, 'intoneLines'),
          takes: Reflect.get(window, 'intoneTakes'),
          changes: Reflect.get(window, 'intoneStatus').count,
          sameStatus:
            Reflect.get(window, 'intoneStatus').status ===
            document.querySelector('[role="status"]'),
        }))
        await report(testInfo, 'worst-stretch.json', {
          nativeFrom,
          nativeTo,
          ...heard,
        })
        // The line before the take, whole, then its worst stretch: from
        // the stretch's start, for about its 0.4 s.
        expect(heard.lines).toHaveLength(2)
        const stretch = heard.lines[1]
        expect(stretch.from).toBeCloseTo(nativeFrom, 1)
        expect(stretch.seconds).toBeGreaterThan(0.35)
        expect(stretch.seconds).toBeLessThan(0.6)
        // The take's part paired with it: a stretch of the take, not all
        // of its 2 s.
        expect(heard.takes).toHaveLength(1)
        expect(heard.takes[0]).toBeGreaterThan(0.2)
        expect(heard.takes[0]).toBeLessThan(1)
        expect(heard.changes).toBe(0)
        expect(heard.sameStatus).toBe(true)
        await expect(page.getByRole('status')).toHaveText(said ?? '')
        expect(problems).toStrictEqual([])
      },
      { hasTouch: true },
    )
  } finally {
    await browser.close()
  }
})
