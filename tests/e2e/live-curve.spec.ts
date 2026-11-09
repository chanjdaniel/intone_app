import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { launch, openLine, report, withPage } from './take-session.ts'

// The live curve in the built app, end to end: Chromium's fake microphone
// plays a synthetic voice, and the page is watched at three points of the
// audio path, timed by the page's own clock (performance.now):
//
// 1. each batch the app hands to the tracker Worker, read before it is
//    transferred: where the voice's last loud sample is;
// 2. each message the Worker sends back: the frames it has found, and the
//    finished curve;
// 3. each paint of the live canvas, which says on itself how far it has
//    drawn (data-drawn-frames, data-drawn-last-voiced).
//
// docs/latency.md says what the numbers mean and records them against the
// report's latency budget.

const fixtures = join(import.meta.dirname, '..', '..', 'fixtures', 'synthetic')

// A sample at least this loud (-46 dBFS) is the voice; the voice's 25 ms
// fade ends below it, in the room's silence.
const loudSample = 0.005

// From the voice's end to the frame that shows it on screen, measured on
// this machine at 174 to 210 ms (docs/latency.md). The allowance above
// that is for a busy CI runner, and is still the report's budget.
const largestDelayMs = 260

type Watched = Readonly<{
  sampleRate: number
  batches: ReadonlyArray<
    Readonly<{ t: number; length: number; lastLoud: number }>
  >
  frames: ReadonlyArray<
    Readonly<{ t: number; firstFrame: number; f0Hz: ReadonlyArray<number> }>
  >
  tracked: ReadonlyArray<number> | null
  paints: ReadonlyArray<
    Readonly<{ t: number; frames: number; lastVoiced: number }>
  >
}>

// Watches the audio path from the page's start (see the top of the file).
const watchAudioPath = async (page: Page): Promise<void> => {
  await page.addInitScript(loud => {
    const batches: Array<{ t: number; length: number; lastLoud: number }> = []
    const frames: Array<{
      t: number
      firstFrame: number
      f0Hz: Array<number>
    }> = []
    const paints: Array<{ t: number; frames: number; lastVoiced: number }> = []
    const watched: {
      sampleRate: number
      tracked: Array<number> | null
    } = {
      sampleRate: 0,
      tracked: null,
    }
    Object.assign(window, {
      intoneWatched: Object.assign(watched, { batches, frames, paints }),
    })

    const tagOf = (data: unknown): unknown => Reflect.get(Object(data), '_tag')
    const fieldOf = (data: unknown, field: string): unknown =>
      Reflect.get(Object(data), field)

    const post = Worker.prototype.postMessage
    Object.defineProperty(Worker.prototype, 'postMessage', {
      value: function (this: Worker, ...args: Array<unknown>): void {
        const [message] = args
        const samples = fieldOf(message, 'samples')
        if (tagOf(message) === 'Start') {
          watched.sampleRate = Number(fieldOf(message, 'sampleRate'))
        }
        if (tagOf(message) === 'Batch' && samples instanceof Float32Array) {
          let lastLoud = -1
          samples.forEach((sample, i) => {
            if (Math.abs(sample) >= loud) {
              lastLoud = i
            }
          })
          batches.push({
            t: performance.now(),
            length: samples.length,
            lastLoud,
          })
        }
        Reflect.apply(post, this, args)
      },
    })

    class WatchedWorker extends Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', ({ data }) => {
          const f0Hz = fieldOf(data, 'f0Hz')
          if (!(f0Hz instanceof Float32Array)) {
            return
          }
          if (tagOf(data) === 'Frames') {
            frames.push({
              t: performance.now(),
              firstFrame: Number(fieldOf(data, 'firstFrame')),
              f0Hz: Array.from(f0Hz),
            })
          }
          if (tagOf(data) === 'Tracked') {
            watched.tracked = Array.from(f0Hz)
          }
        })
      }
    }
    Object.assign(window, { Worker: WatchedWorker })

    new MutationObserver(records => {
      const t = performance.now()
      records.forEach(({ target }) => {
        if (target instanceof Element) {
          paints.push({
            t,
            frames: Number(target.getAttribute('data-drawn-frames')),
            lastVoiced: Number(target.getAttribute('data-drawn-last-voiced')),
          })
        }
      })
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-drawn-frames'],
    })
  }, loudSample)
}

// Forgets what was watched so far: the line's own run through the
// tracker, when the screen opened.
const resetWatched = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const watched = Reflect.get(window, 'intoneWatched')
    watched.sampleRate = 0
    watched.tracked = null
    watched.batches.length = 0
    watched.frames.length = 0
    watched.paints.length = 0
  })

const watchedOf = (page: Page): Promise<Watched> =>
  page.evaluate((): Watched => Reflect.get(window, 'intoneWatched'))

// From the voice's last loud sample to the live curve's last voiced frame
// on screen, stage by stage.
const delaysOf = (watched: Watched) => {
  const rate = watched.sampleRate
  // Each batch's first sample, as a sample of the take.
  const starts = watched.batches.reduce<Array<number>>(
    (sums, batch, i) => [...sums, (sums[i] ?? 0) + batch.length],
    [0],
  )
  const endBatch = watched.batches.reduce(
    (last, batch, i) => (batch.lastLoud >= 0 ? i : last),
    -1,
  )
  const end = watched.batches[endBatch]
  if (end === undefined) {
    throw new Error('the take had no voice')
  }
  // The audio thread posts a batch when its last sample is in: the
  // voice's end waited this long in the worklet before.
  const batchingMs = ((end.length - end.lastLoud) / rate) * 1000
  const voiceEndAt = end.t - batchingMs

  const lastVoiced = Math.max(
    ...watched.frames.flatMap(({ firstFrame, f0Hz }) =>
      f0Hz.flatMap((hz, i) => (hz > 0 ? [firstFrame + i] : [])),
    ),
  )
  // The frame needs the take's audio up to 10 frames past its own end,
  // at 16 kHz, 256 samples a frame.
  const neededSample = ((lastVoiced + 11) * 256 * rate) / 16_000
  const needed = watched.batches.find(
    (batch, i) => (starts[i] ?? 0) + batch.length >= neededSample,
  )
  const found = watched.frames.find(
    ({ firstFrame, f0Hz }) =>
      firstFrame <= lastVoiced && lastVoiced < firstFrame + f0Hz.length,
  )
  const drawn = watched.paints.find(paint => paint.lastVoiced >= lastVoiced)
  if (needed === undefined || found === undefined || drawn === undefined) {
    throw new Error('the live curve never showed the voice ending')
  }
  return {
    lastVoicedFrame: lastVoiced,
    voiceEndSample: (starts[endBatch] ?? 0) + end.lastLoud,
    batchingMs,
    lookaheadMs: needed.t - end.t,
    trackingMs: found.t - needed.t,
    paintMs: drawn.t - found.t,
    totalMs: drawn.t - voiceEndAt,
  }
}

const recordFor = async (page: Page, seconds: number): Promise<void> => {
  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('timer')).toHaveText(
    new RegExp(`^0:${String(seconds).padStart(2, '0')} of 0:30$`),
    { timeout: (seconds + 10) * 1000 },
  )
}

test.describe('the live curve', () => {
  for (const voice of ['low', 'middle', 'high'] as const) {
    test(`draws the ${voice} voice as it is heard, within the measured delay, and ends as the finished curve`, async ({
      playwright,
    }, testInfo) => {
      test.setTimeout(90_000)
      const browser = await launch(playwright, join(fixtures, `${voice}.wav`))
      try {
        await withPage(browser, async ({ page, problems }) => {
          await watchAudioPath(page)
          await openLine(page)
          await resetWatched(page)
          await recordFor(page, 3)
          const live = page.getByRole('img', {
            name: /^Your pitch, drawn as you speak over the line's/,
          })
          await expect(live).toBeVisible()
          await expect(page.getByRole('meter')).toHaveAccessibleName(
            'Microphone level',
          )
          await page.getByRole('button', { name: 'Stop' }).click()
          // Every result screen, scored or not, offers another take.
          await expect(
            page.getByRole('button', { name: 'Record again' }),
          ).toBeVisible({ timeout: 30_000 })

          const watched = await watchedOf(page)
          const delays = delaysOf(watched)
          await report(testInfo, `${voice}-delays.json`, delays)

          // The voice ends 1.9 s into the file, which plays from about
          // when the microphone opens.
          expect(delays.voiceEndSample / watched.sampleRate).toBeGreaterThan(
            1.85,
          )
          expect(delays.totalMs).toBeLessThan(largestDelayMs)

          // Frames came in order, one message per batch at most, and the
          // live frames are the finished curve's frames.
          watched.frames.reduce((next, { firstFrame, f0Hz }) => {
            expect(firstFrame).toBe(next)
            return next + f0Hz.length
          }, 0)
          expect(watched.frames.length).toBeLessThanOrEqual(
            watched.batches.length + 2,
          )
          const liveF0 = watched.frames.flatMap(({ f0Hz }) => f0Hz)
          expect(watched.tracked).not.toBe(null)
          expect(liveF0).toHaveLength(watched.tracked?.length ?? 0)
          const largestDifference = Math.max(
            ...liveF0.map((hz, frame) =>
              Math.abs(hz - (watched.tracked?.[frame] ?? Number.NaN)),
            ),
          )
          expect(largestDifference).toBeLessThan(0.01)

          // The canvas drew while the take recorded, not only at its end.
          const voicedPaints = watched.paints.filter(
            paint => paint.lastVoiced >= 0,
          )
          expect(voicedPaints.length).toBeGreaterThan(30)
          expect(problems).toStrictEqual([])
        })
      } finally {
        await browser.close()
      }
    })
  }
})
