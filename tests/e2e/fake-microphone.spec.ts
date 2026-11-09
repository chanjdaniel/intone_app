import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type Browser,
  type BrowserType,
  type Page,
  type TestInfo,
  expect,
  test,
} from '@playwright/test'

import {
  type WavEncoding,
  decodeWav,
  encodeWav,
} from '../../src/engine/audio/wav.ts'
import {
  type Comparison,
  compareWithSource,
  lowPass,
} from '../support/audio-compare.ts'
import { type PitchError, estimatePitch, pitchError } from '../support/pitch.ts'
import {
  type SyntheticVoiceLabels,
  type VoiceName,
  synthesiseVoice,
  voiceNames,
  voicedFramesAwayFromEdges,
} from '../support/synthetic-voice.ts'
import { probePort } from './ports.ts'
import type { Capture } from './probe/protocol.ts'

// Chromium's fake microphone playing a known WAV into the app's capture
// worklet, and the app's buffer source playing the same WAV into it, on
// the test-only probe page (tests/e2e/probe/). docs/fake-microphone.md
// reports what these measure and why each tolerance is what it is.

const fixtures = join(import.meta.dirname, '..', '..', 'fixtures', 'synthetic')
const probe = `http://127.0.0.1:${probePort}/`
// The fixture lasts 2.3 s; the capture runs on past it, so a late start
// still holds the whole voice.
const captureSeconds = 3

type Source = Readonly<{
  samples: Float32Array
  sampleRate: number
  labels: SyntheticVoiceLabels
}>

const fixture = (name: VoiceName): Source & { file: string } => {
  const file = join(fixtures, `${name}.wav`)
  const wav = decodeWav(readFileSync(file))
  return {
    file,
    samples: wav.channels[0] ?? new Float32Array(),
    sampleRate: wav.sampleRate,
    labels: JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8')),
  }
}

const samplesOf = (capture: Capture): Float32Array => {
  const bytes = Buffer.from(capture.samples, 'base64')
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
}

type Measurement = Comparison &
  Readonly<{
    pitch: PitchError
    // The same estimate on the source itself: what the estimate alone
    // gets wrong.
    sourcePitch: PitchError
    batchLengths: ReadonlyArray<number>
  }>

// The capture against its source, the samples compared below `belowHz`
// when given, for a path that cuts the top of the source's band.
const measure = (
  capture: Capture,
  source: Source,
  belowHz?: number,
): Measurement | null => {
  const received = samplesOf(capture)
  const band = (samples: Float32Array, sampleRate: number) =>
    belowHz === undefined ? samples : lowPass(samples, sampleRate, belowHz)
  const comparison = compareWithSource(
    band(received, capture.sampleRate),
    capture.sampleRate,
    band(source.samples, source.sampleRate),
    source.sampleRate,
  )
  if (comparison === null) {
    return null
  }
  const frames = voicedFramesAwayFromEdges(source.labels)
  const { frameHz, f0Hz } = source.labels
  return {
    ...comparison,
    pitch: pitchError(
      pitchAcrossSlips(received, capture.sampleRate, frameHz, comparison),
      f0Hz,
      frames,
    ),
    sourcePitch: pitchError(
      estimatePitch(source.samples, source.sampleRate, frameHz),
      f0Hz,
      frames,
    ),
    batchLengths: [...new Set(capture.batchLengths)],
  }
}

// The pitch estimate of the received audio, each frame read where the
// source sits at that point, after the slips before it.
const pitchAcrossSlips = (
  received: Float32Array,
  sampleRate: number,
  frameHz: number,
  { delaySeconds, slips }: Comparison,
): Float64Array => {
  const delays = slips.reduce(
    (sum, slip) => [...sum, (sum.at(-1) ?? 0) + slip.bySeconds],
    [delaySeconds],
  )
  const estimates = delays.map(delay =>
    estimatePitch(received, sampleRate, frameHz, delay),
  )
  return Float64Array.from(estimates[0] ?? [], (_, frame) => {
    let stretch = 0
    slips.forEach((slip, index) => {
      if (slip.atSeconds <= frame / frameHz + (delays[index + 1] ?? 0)) {
        stretch = index + 1
      }
    })
    return estimates[stretch]?.[frame] ?? Number.NaN
  })
}

const openProbe = async (page: Page): Promise<void> => {
  const problems: Array<string> = []
  page.on('pageerror', error => problems.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') {
      problems.push(message.text())
    }
  })
  await page.goto(probe)
  await page.waitForFunction(() => 'intoneProbe' in window)
  expect(problems).toStrictEqual([])
}

// A browser whose microphone plays `file` once, then silence.
const withFakeMicrophone = async <A>(
  browserType: BrowserType,
  file: string,
  use: (page: Page) => Promise<A>,
): Promise<A> => {
  const browser: Browser = await browserType.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${file}%noloop`,
      // The app starts audio from a tap; the probe has no one to tap.
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  try {
    const page = await browser.newPage()
    await openProbe(page)
    return await use(page)
  } finally {
    await browser.close()
  }
}

const recordThroughMicrophone = (
  browserType: BrowserType,
  file: string,
  options: { browserProcessing?: boolean } = {},
): Promise<Capture> =>
  withFakeMicrophone(browserType, file, page =>
    page.evaluate(request => window.intoneProbe.fromMicrophone(request), {
      seconds: captureSeconds,
      sampleRate: 48000,
      browserProcessing: options.browserProcessing ?? false,
    }),
  )

const report = async (
  testInfo: TestInfo,
  name: string,
  body: unknown,
): Promise<void> => {
  await testInfo.attach(name, {
    body: JSON.stringify(body, null, 2),
    contentType: 'application/json',
  })
}

// What the fake microphone delivers from a 16-bit source, slips aside:
// the source's own gain, nothing added beyond 16-bit quantisation and
// resampling between slips, each slip 10 ms of samples added, and a pitch
// estimate as close to the known curve as the source's own, but for the
// frames a slip falls in.
const expectFaithful = (measurement: Measurement | null): void => {
  expect(measurement).not.toBeNull()
  if (measurement === null) {
    return
  }
  expect(measurement.gain).toBeGreaterThan(0.999)
  expect(measurement.gain).toBeLessThan(1.001)
  expect(measurement.snrDb).toBeGreaterThan(70)
  for (const slip of measurement.slips) {
    expect(slip.bySeconds).toBeCloseTo(0.01, 4)
  }
  const slips = measurement.slips.length
  expect(measurement.pitch.missing).toBeLessThanOrEqual(
    measurement.sourcePitch.missing + 2 * slips,
  )
  expect(measurement.pitch.medianCents).toBeLessThan(
    measurement.sourcePitch.medianCents + 0.5,
  )
  if (slips === 0) {
    expect(measurement.pitch.maxCents).toBeLessThan(
      measurement.sourcePitch.maxCents + 2,
    )
  }
}

test.describe('the buffer source', () => {
  for (const name of voiceNames) {
    test(`plays the ${name} voice into the capture worklet sample for sample`, async ({
      page,
    }, testInfo) => {
      const source = fixture(name)
      await openProbe(page)
      const capture = await page.evaluate(
        request => window.intoneProbe.fromBuffer(request),
        {
          wav: readFileSync(source.file).toString('base64'),
          seconds: captureSeconds,
          sampleRate: 48000,
          offline: true,
        },
      )
      const measurement = measure(capture, source)
      await report(testInfo, `buffer-${name}.json`, measurement)
      expect(measurement?.delaySeconds).toBeCloseTo(0, 6)
      expect(measurement?.maxDifference).toBe(0)
      // 20 ms at 48 kHz.
      expect(measurement?.batchLengths).toStrictEqual([960])
    })
  }

  test('plays in real time into a running AudioContext unchanged', async ({
    page,
  }, testInfo) => {
    const source = fixture('middle')
    await openProbe(page)
    const capture = await page.evaluate(
      request => window.intoneProbe.fromBuffer(request),
      {
        wav: readFileSync(source.file).toString('base64'),
        seconds: captureSeconds,
        sampleRate: 48000,
        offline: false,
      },
    )
    const measurement = measure(capture, source)
    await report(testInfo, 'buffer-realtime-middle.json', measurement)
    expect(measurement?.maxDifference).toBe(0)
    expect(measurement?.gain).toBe(1)
  })
})

test.describe('the fake microphone', () => {
  for (const name of voiceNames) {
    test(`delivers the ${name} voice to the capture worklet unaltered but resampled`, async ({
      playwright,
    }, testInfo) => {
      const source = fixture(name)
      const capture = await recordThroughMicrophone(
        playwright.chromium,
        source.file,
      )
      const measurement = measure(capture, source)
      await report(testInfo, `microphone-${name}.json`, {
        settings: capture.settings,
        measurement,
      })
      expectFaithful(measurement)
      expect(capture.settings).toMatchObject({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      })
      // The device's file starts at getUserMedia, after the worklet runs:
      // the probe waits for its first batch, as the app should.
      expect(measurement?.delaySeconds).toBeGreaterThan(0)
      expect(measurement?.delaySeconds).toBeLessThan(0.1)
    })
  }

  test('agrees with itself over twenty runs', async ({
    playwright,
  }, testInfo) => {
    test.setTimeout(240_000)
    const source = fixture('middle')
    const runs: Array<Measurement | null> = []
    for (let run = 0; run < 20; run++) {
      runs.push(
        measure(
          await recordThroughMicrophone(playwright.chromium, source.file),
          source,
        ),
      )
    }
    const found = runs.filter(run => run !== null)
    const spread = (values: ReadonlyArray<number>) => ({
      min: Math.min(...values),
      max: Math.max(...values),
      range: Math.max(...values) - Math.min(...values),
    })
    const variation = {
      delaySeconds: spread(found.map(run => run.delaySeconds)),
      slips: spread(found.map(run => run.slips.length)),
      gain: spread(found.map(run => run.gain)),
      snrDb: spread(found.map(run => run.snrDb)),
      pitchMedianCents: spread(found.map(run => run.pitch.medianCents)),
      pitchMaxCents: spread(found.map(run => run.pitch.maxCents)),
    }
    await report(testInfo, 'microphone-twenty-runs.json', { variation, runs })
    for (const run of runs) {
      expectFaithful(run)
    }
    expect(variation.gain.range).toBeLessThan(1e-4)
    expect(variation.snrDb.range).toBeLessThan(3)
    expect(variation.pitchMedianCents.range).toBeLessThan(0.5)
    expect(variation.pitchMaxCents.range).toBeLessThan(2)
    // The start moves in whole 10 ms device buffers.
    expect(variation.delaySeconds.range).toBeLessThan(0.035)
  })

  test('alters the audio when the browser processing is left on', async ({
    playwright,
  }, testInfo) => {
    const source = fixture('middle')
    const capture = await recordThroughMicrophone(
      playwright.chromium,
      source.file,
      {
        browserProcessing: true,
      },
    )
    const measurement = measure(capture, source)
    await report(testInfo, 'microphone-browser-processing.json', {
      settings: capture.settings,
      measurement,
    })
    expect(capture.settings).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
    expect(measurement?.snrDb ?? 0).toBeLessThan(40)
  })

  test.describe('with WAV files of other formats', () => {
    type Format = Readonly<{
      sampleRate: number
      encoding: WavEncoding
      channels: 1 | 2
      // Whether its audio arrived.
      arrives: boolean
      // Where the device's resampler cut its band, when it cut it below
      // the file's own Nyquist frequency.
      cutBelowHz?: number
    }>
    // Each format the fake device was given.
    const formats: ReadonlyArray<Format> = [
      {
        sampleRate: 8000,
        encoding: 'pcm16',
        channels: 1,
        arrives: true,
        cutBelowHz: 3500,
      },
      { sampleRate: 16000, encoding: 'pcm16', channels: 1, arrives: true },
      { sampleRate: 22050, encoding: 'pcm16', channels: 1, arrives: true },
      { sampleRate: 44100, encoding: 'pcm16', channels: 1, arrives: true },
      { sampleRate: 48000, encoding: 'pcm16', channels: 2, arrives: true },
      { sampleRate: 96000, encoding: 'pcm16', channels: 1, arrives: true },
      { sampleRate: 48000, encoding: 'pcm8', channels: 1, arrives: true },
      { sampleRate: 48000, encoding: 'pcm24', channels: 1, arrives: false },
      { sampleRate: 48000, encoding: 'pcm32', channels: 1, arrives: true },
      { sampleRate: 48000, encoding: 'float32', channels: 1, arrives: true },
    ]
    let scratch = ''
    test.beforeAll(() => {
      scratch = mkdtempSync(join(tmpdir(), 'fake-microphone-'))
    })
    test.afterAll(() => {
      rmSync(scratch, { recursive: true, force: true })
    })

    for (const format of formats) {
      const label = `${format.sampleRate} Hz ${format.encoding} ${format.channels === 1 ? 'mono' : 'stereo'}`
      const outcome = !format.arrives
        ? 'arrives as silence'
        : format.cutBelowHz === undefined
          ? 'arrives'
          : `arrives cut below ${format.cutBelowHz} Hz`
      test(`${label} ${outcome}`, async ({ playwright }, testInfo) => {
        const { samples, labels } = synthesiseVoice('middle', format.sampleRate)
        const file = join(
          scratch,
          `${format.sampleRate}-${format.encoding}-${format.channels}.wav`,
        )
        writeFileSync(
          file,
          encodeWav({
            sampleRate: format.sampleRate,
            encoding: format.encoding,
            channels: Array.from({ length: format.channels }, () => samples),
          }),
        )
        const source = decodeWav(readFileSync(file))
        const measurement = measure(
          await recordThroughMicrophone(playwright.chromium, file),
          {
            samples: source.channels[0] ?? new Float32Array(),
            sampleRate: format.sampleRate,
            labels,
          },
          format.cutBelowHz,
        )
        await report(testInfo, `format-${label}.json`, measurement)
        expect(measurement !== null).toBe(format.arrives)
        if (measurement !== null) {
          expect(measurement.gain).toBeGreaterThan(0.99)
          expect(measurement.gain).toBeLessThan(1.01)
          // 8-bit quantisation's own noise is about 40 dB down.
          expect(measurement.snrDb).toBeGreaterThan(35)
          for (const slip of measurement.slips) {
            expect(slip.bySeconds).toBeCloseTo(0.01, 4)
          }
          // The estimate reads a voice sampled at 8 kHz worse than the
          // device's band-cut copy of it, so this bound is the estimate's
          // own on the 48 kHz voice, not the source's.
          expect(measurement.pitch.medianCents).toBeLessThan(3)
        }
      })
    }
  })
})
