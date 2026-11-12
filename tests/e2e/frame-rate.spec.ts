import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { decodeWav, encodeWav } from '../../src/engine/audio/wav.ts'
import { launch, openLine, report, withPage } from './take-session.ts'

// The live curve's frame rate: a 20 s take in the built app, drawn over
// the line's curve, with the CPU slowed six times, as a phone's might be,
// must keep the page at 60 frames a second. It is the check every Foldkit upgrade runs
// (docs/upgrading.md), and runs in a Playwright project of its own, after
// every other end-to-end test has finished, so that no other test's
// browser shares the machine while it measures.

const fixtures = join(import.meta.dirname, '..', '..', 'fixtures', 'synthetic')

test('holds 60 frames a second through a 20 s take at 6x CPU throttle', async ({
  playwright,
}, testInfo) => {
  test.setTimeout(120_000)
  // The middle voice nine times over: 20.7 s.
  const voice = decodeWav(readFileSync(join(fixtures, 'middle.wav')))
  const once = voice.channels[0] ?? new Float32Array(0)
  const repeated = new Float32Array(once.length * 9)
  Array.from({ length: 9 }, (_, i) => repeated.set(once, i * once.length))
  const wav = testInfo.outputPath('middle-nine-times.wav')
  writeFileSync(
    wav,
    encodeWav({ ...voice, encoding: 'pcm16', channels: [repeated] }),
  )

  const browser = await launch(playwright, wav)
  try {
    await withPage(browser, async ({ context, page, problems }) => {
      await openLine(page)
      const devTools = await context.newCDPSession(page)
      await devTools.send('Emulation.setCPUThrottlingRate', { rate: 6 })

      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Recording' }),
      ).toBeVisible({ timeout: 60_000 })
      // Every animation frame's time, from here to the take's 20th
      // second.
      await page.evaluate(() => {
        const times: Array<number> = []
        Object.assign(window, { intoneFrameTimes: times })
        const onFrame = (t: number): void => {
          times.push(t)
          requestAnimationFrame(onFrame)
        }
        requestAnimationFrame(onFrame)
      })
      await expect(page.getByRole('timer')).toHaveText(/^0:20 of 0:30$/, {
        timeout: 40_000,
      })
      const times = await page.evaluate((): Array<number> =>
        Reflect.get(window, 'intoneFrameTimes'),
      )
      const drawnFrames = Number(
        await page
          .getByRole('img', { name: /^Your pitch, drawn as you speak/ })
          .getAttribute('data-drawn-frames'),
      )
      await page.getByRole('button', { name: 'Stop' }).click()
      // A 20 s take is far longer than the line, so it is not scored:
      // every result screen offers another take.
      await expect(
        page.getByRole('button', { name: 'Record again' }),
      ).toBeVisible({ timeout: 60_000 })
      await devTools.send('Emulation.setCPUThrottlingRate', { rate: 1 })

      const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t))
      const seconds = ((times.at(-1) ?? 0) - (times[0] ?? 0)) / 1000
      // A long frame is one that missed a refresh: from 25 ms, one and a
      // half refreshes, clear of the timer's jitter on either side of
      // 16.7 ms and of 33.3 ms (docs/latency.md).
      const longFrames = gaps.filter(gap => gap >= 25)
      const framesPerSecond = gaps.length / seconds
      const measured = {
        seconds,
        frames: gaps.length,
        framesPerSecond,
        longFrames,
        largestGapMs: Math.max(...gaps),
        drawnFrames,
      }
      await report(testInfo, 'frame-rate.json', measured)
      // In the run's log as well, where CI keeps a passing run's numbers.
      process.stdout.write(`frame-rate.json ${JSON.stringify(measured)}\n`)

      expect(seconds).toBeGreaterThan(18)
      expect(framesPerSecond).toBeGreaterThan(58)
      // At most 5 frames of the 1,200 at 25 ms or longer.
      expect(longFrames.length).toBeLessThanOrEqual(5)
      // The curve kept up all through: by the 20th second it had drawn
      // the take's frames to within half a second of the voice.
      expect(drawnFrames).toBeGreaterThan((20 - 0.5) * 62.5)
      expect(problems).toStrictEqual([])
    })
  } finally {
    await browser.close()
  }
})
