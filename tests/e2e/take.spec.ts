import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { plotArea, semitonesOfY } from '../../src/engine/draw/curve.ts'
import {
  type SyntheticVoiceLabels,
  type VoiceName,
  voiceNames,
  voicedFramesAwayFromEdges,
} from '../support/synthetic-voice.ts'
import {
  launch,
  openLine,
  report,
  trackStates,
  withPage,
} from './take-session.ts'

// A take in the built app, end to end: Chromium's fake microphone plays a
// synthetic voice into the real capture worklet, the tracker Worker runs
// SwiftF0, and the curve the app draws is read back off its canvas and
// compared with the F0 the voice was made from. It is read off the live
// canvas once the voice has ended, before stop: the result draws the take
// lined up with the line instead, where its own timing no longer shows,
// and a loud take's live frames are its finished curve's
// (./live-curve.spec.ts). docs/fake-microphone.md
// says what the fake microphone delivers and what a test must allow for.

const fixtures = join(import.meta.dirname, '..', '..', 'fixtures', 'synthetic')
// The fixture's voice starts half a second into the file.
const voiceStartSeconds = 0.5
// How closely the drawn curve must follow the known F0, in semitones from
// each one's own median, over the voiced frames away from voicing edges.
// Measured on all three voices, six runs each at a load average of 22 to
// 30, with the lag fitted to the RMS error: a median of 0.015 to 0.054, a
// 95th percentile of 0.04 to 0.11 and a largest of 0.17, every frame
// drawn. Read off the live canvas at 4 s, as now, two runs each at a load
// average of 3: a median of 0.017 to 0.055, a 95th percentile of 0.05 to
// 0.11 and a largest of 0.14, every frame drawn.
// The allowance above that is for a slip of the fake microphone, which
// moves the rest of a take 10 ms, up to 0.4 semitones on the fastest glide
// and the frames near it lost (docs/fake-microphone.md).
const tolerance = { medianSemitones: 0.1, p95Semitones: 0.45, coverage: 0.95 }

const wavOf = (name: VoiceName): string => join(fixtures, `${name}.wav`)

const labelsOf = (name: VoiceName): SyntheticVoiceLabels =>
  JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8'))

// Records until the clock shows `seconds`, still recording.
const recordFor = async (page: Page, seconds: number): Promise<void> => {
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible({
    timeout: 30_000,
  })
  expect(await trackStates(page)).toStrictEqual(['live'])
  await expect(
    page.getByText(new RegExp(`^0:0${seconds} of 0:30`)),
  ).toBeVisible({ timeout: (seconds + 5) * 1000 })
}

// The curve as drawn on the learner's live canvas, which holds nothing
// else: for each column, the centre of its solid pixels, as seconds from
// the onset and semitones from the median, by the painter's own axis.
const readDrawnCurve = async (page: Page) => {
  const canvas = page.getByRole('img', {
    name: /^Your pitch, drawn as you speak/,
  })
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-span-seconds', /\d/)
  // The span and the pixels are read at once, between two paints.
  const drawn = await canvas.evaluate(canvas => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('the curve is not a canvas')
    }
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('no 2D context')
    }
    const { data, width, height } = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const columns: Array<number | null> = []
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let y = 0; y < height; y++) {
        const at = (y * width + x) * 4
        if ((data[at + 3] ?? 0) > 200) {
          sum += y
          count++
        }
      }
      columns.push(count === 0 ? null : sum / count)
    }
    return {
      seconds: Number(canvas.getAttribute('data-span-seconds')),
      columns,
      backing: { width: canvas.width, height: canvas.height },
      css: { width: canvas.clientWidth, height: canvas.clientHeight },
    }
  })
  const seconds = drawn.seconds
  const ratio = drawn.backing.width / drawn.css.width
  const area = plotArea(drawn.css.width, drawn.css.height)
  const points = drawn.columns.flatMap((y, column) => {
    const x = (column + 0.5) / ratio
    return y === null || x < area.left || x > area.left + area.width
      ? []
      : [
          {
            seconds: ((x - area.left) / area.width) * seconds,
            semitones: semitonesOfY(area, (y + 0.5) / ratio),
          },
        ]
  })
  return { points, ...drawn }
}

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? Number.NaN)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

const quantile = (values: ReadonlyArray<number>, q: number): number =>
  [...values].sort((a, b) => a - b)[Math.round(q * (values.length - 1))] ??
  Number.NaN

// The drawn curve against the known F0 at each voiced frame away from the
// edges, with the curve's start allowed to sit a few frames from the
// file's voice start: the tracker's onset frame, and the fake
// microphone's start, which lands on whole 10 ms device buffers.
const compareWithLabels = (
  points: ReadonlyArray<Readonly<{ seconds: number; semitones: number }>>,
  labels: SyntheticVoiceLabels,
) => {
  const frames = voicedFramesAwayFromEdges(labels)
  const knownMedian = median(
    labels.f0Hz.flatMap(hz => (hz === null ? [] : [hz])),
  )
  const drawnAt = (seconds: number): number | null => {
    let best: Readonly<{ seconds: number; semitones: number }> | null = null
    for (const point of points) {
      if (
        Math.abs(point.seconds - seconds) < 0.008 &&
        (best === null ||
          Math.abs(point.seconds - seconds) < Math.abs(best.seconds - seconds))
      ) {
        best = point
      }
    }
    return best?.semitones ?? null
  }
  const at = (lag: number) => {
    const errors = frames.flatMap(frame => {
      const hz = labels.f0Hz[frame]
      const drawn = drawnAt(frame / labels.frameHz - voiceStartSeconds + lag)
      return hz === null || hz === undefined || drawn === null
        ? []
        : [Math.abs(drawn - 12 * Math.log2(hz / knownMedian))]
    })
    return {
      lag,
      compared: frames.length,
      coverage: errors.length / frames.length,
      medianSemitones: median(errors),
      p95Semitones: quantile(errors, 0.95),
      maxSemitones: quantile(errors, 1),
      rmsSemitones: Math.sqrt(
        errors.reduce((sum, error) => sum + error * error, 0) / errors.length,
      ),
    }
  }
  // The lag is fitted to the RMS error, not the median: the flat
  // stretches fit almost any lag, so the glides must weigh in placing the
  // curve in time, and after a slip the fit splits it between the
  // stretches either side.
  const lags = Array.from({ length: 81 }, (_, i) => (i - 40) * 0.002)
  return lags
    .map(at)
    .reduce((best, next) =>
      next.coverage >= best.coverage - 0.02 &&
      next.rmsSemitones < best.rmsSemitones
        ? next
        : best,
    )
}

for (const voice of voiceNames) {
  test(`a take of the ${voice} voice draws its known F0, privately, and releases the microphone`, async ({
    playwright,
    baseURL,
  }, testInfo) => {
    test.setTimeout(90_000)
    const browser = await launch(playwright, wavOf(voice))
    try {
      await withPage(browser, async ({ page, requests, problems }) => {
        // The microphone logs what the browser gave for the constraints it
        // asked, which are best effort.
        const logged: Array<string> = []
        page.on('console', message => logged.push(message.text()))
        await openLine(page)
        const beforeTake = requests.length
        // The voice ends 1.9 s into the file; by 4 s its last frames are
        // drawn and the drawn median has settled on its own.
        await recordFor(page, 4)
        const drawn = await readDrawnCurve(page)
        await page.getByRole('button', { name: 'Stop' }).click()
        await expect(
          page.getByRole('button', { name: 'Record again' }),
        ).toBeVisible({ timeout: 30_000 })
        // Released on stop.
        expect(await trackStates(page)).toStrictEqual(['ended'])
        const opened = logged.find(text => text.includes('Microphone opened'))
        expect(opened, 'the microphone logs its settings').toBeDefined()
        expect(opened).toMatch(/echoCancellation/)

        // Crisp: two device pixels behind each CSS pixel.
        expect(drawn.backing).toStrictEqual({
          width: drawn.css.width * 2,
          height: drawn.css.height * 2,
        })
        const comparison = compareWithLabels(drawn.points, labelsOf(voice))
        await report(testInfo, `${voice}-curve.json`, {
          seconds: drawn.seconds,
          comparison,
        })
        // The voice lasts 1.4 s from its onset to its last voiced frame,
        // and the width has room for it beside the line.
        const lastPoint = Math.max(...drawn.points.map(point => point.seconds))
        expect(lastPoint).toBeGreaterThan(1.3)
        expect(lastPoint).toBeLessThan(1.5)
        expect(drawn.seconds).toBeGreaterThanOrEqual(lastPoint)
        expect(comparison.coverage).toBeGreaterThanOrEqual(tolerance.coverage)
        expect(comparison.medianSemitones).toBeLessThan(
          tolerance.medianSemitones,
        )
        expect(comparison.p95Semitones).toBeLessThan(tolerance.p95Semitones)

        // Private: every request of the take went to the app's own
        // origin, and none carried a body.
        const take = requests.slice(beforeTake)
        await report(testInfo, `${voice}-requests.json`, take)
        expect(take.length).toBeGreaterThan(0)
        for (const request of take) {
          expect(request.url.startsWith(`${baseURL}/`)).toBe(true)
          expect(request.method).toBe('GET')
          expect(request.body).toBe(null)
        }
        expect(problems).toStrictEqual([])
      })
    } finally {
      await browser.close()
    }
  })
}

test('leaving the screen mid-take releases the microphone', async ({
  playwright,
}) => {
  test.setTimeout(60_000)
  const browser = await launch(playwright, wavOf('middle'))
  try {
    await withPage(browser, async ({ page, problems }) => {
      await page.goto('/')
      await page.getByRole('link', { name: /^Copy 雨が好き/ }).click()
      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Recording' }),
      ).toBeVisible({ timeout: 30_000 })
      expect(await trackStates(page)).toStrictEqual(['live'])
      await page.goBack()
      await expect(
        page.getByRole('heading', { name: 'Lines to copy' }),
      ).toBeVisible()
      await expect.poll(() => trackStates(page)).toStrictEqual(['ended'])
      await page.goForward()
      await expect(
        page.getByRole('button', { name: 'Record', exact: true }),
      ).toBeVisible()
      expect(problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})

test('a microphone that stops on its own mid-take ends the take and says why', async ({
  playwright,
}) => {
  test.setTimeout(60_000)
  const browser = await launch(playwright, wavOf('middle'))
  try {
    await withPage(browser, async ({ page, problems }) => {
      await openLine(page)
      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Recording' }),
      ).toBeVisible({ timeout: 30_000 })
      // As Chromium tells a page its microphone was unplugged.
      await page.evaluate(() => {
        const tracks: unknown = Reflect.get(window, 'intoneTracks')
        const track: unknown = Array.isArray(tracks) ? tracks[0] : undefined
        if (!(track instanceof MediaStreamTrack)) {
          throw new Error('no microphone track')
        }
        track.dispatchEvent(new Event('ended'))
      })
      await expect(
        page.getByRole('heading', { name: 'Your take could not be tracked' }),
      ).toBeVisible()
      await expect(
        page.getByText(
          'The microphone stopped during the take: it was unplugged, or the browser took back its permission.',
        ),
      ).toBeVisible()
      await expect.poll(() => trackStates(page)).toStrictEqual(['ended'])
      expect(problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})

test('a refused microphone says how to allow it', async ({ playwright }) => {
  test.setTimeout(60_000)
  const browser = await launch(playwright, wavOf('middle'), false)
  try {
    await withPage(browser, async ({ page }) => {
      await openLine(page)
      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'The microphone is blocked' }),
      ).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByRole('button', { name: 'Try again' }),
      ).toBeFocused()
      expect(await trackStates(page)).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})
