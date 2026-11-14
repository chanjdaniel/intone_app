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
import {
  type PitchError,
  estimatePitch,
  framesReaching,
  pitchError,
} from '../support/pitch.ts'
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
    // How long the worklet's first batch is, after which the probe asks
    // for the microphone.
    firstBatchSeconds: number
    // Where the source's last sample landed, after every slip.
    endSeconds: number
    // The frames whose span reaches what the slips added: all the slips
    // can leave with no pitch.
    slipFrames: number
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
    firstBatchSeconds: (capture.batchLengths[0] ?? 0) / capture.sampleRate,
    slipFrames: comparison.slips.reduce(
      (sum, slip) => sum + framesReaching(slip.bySeconds, frameHz),
      0,
    ),
    endSeconds:
      comparison.delaySeconds +
      comparison.slips.reduce((sum, slip) => sum + slip.bySeconds, 0) +
      source.samples.length / source.sampleRate,
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

// Each slip adds a whole number of the device's 10 ms buffers: one,
// mostly, and up to four at once on a loaded machine.
const expectWholeBuffers = (slips: Comparison['slips']): void => {
  for (const slip of slips) {
    const buffers = Math.round(slip.bySeconds / 0.01)
    expect(buffers).toBeGreaterThanOrEqual(1)
    expect(slip.bySeconds).toBeCloseTo(buffers * 0.01, 4)
  }
}

// What the fake microphone delivers from a 16-bit source, slips aside:
// the whole voice, at the source's own gain, nothing added beyond 16-bit
// quantisation and resampling between slips, each slip a whole number of
// the device's 10 ms buffers added, and a pitch estimate as close to the
// known curve as the source's own, but for the frames whose span reaches
// what a slip added.
const expectFaithful = (measurement: Measurement | null): void => {
  expect(measurement).not.toBeNull()
  if (measurement === null) {
    return
  }
  // The device plays its file from getUserMedia on, and the probe asks for
  // it only once the worklet has posted its first batch, as the app should,
  // so the file's first sample lands after that batch: asked for before the
  // worklet ran, the file loses its start and lands before it. How long
  // getUserMedia and the connection then take is the machine's, and the
  // file's first stretch of silence plays before the source is connected
  // and is lost (docs/fake-microphone.md, "When does the voice start?").
  expect(measurement.delaySeconds).toBeGreaterThan(
    measurement.firstBatchSeconds,
  )
  expect(measurement.endSeconds).toBeLessThan(captureSeconds)
  expect(measurement.gain).toBeGreaterThan(0.999)
  expect(measurement.gain).toBeLessThan(1.001)
  expect(measurement.snrDb).toBeGreaterThan(70)
  expectWholeBuffers(measurement.slips)
  const slips = measurement.slips.length
  // Each slip costs no more frames than the estimate's span lets it,
  // however many slips the machine's load brings.
  expect(measurement.pitch.missing).toBeLessThanOrEqual(
    measurement.sourcePitch.missing + measurement.slipFrames,
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

  test("is the Microphone service's test layer, which plays it sample for sample", async ({
    page,
  }, testInfo) => {
    const source = fixture('middle')
    await openProbe(page)
    const capture = await page.evaluate(
      request => window.intoneProbe.fromMicrophoneService(request),
      {
        wav: readFileSync(source.file).toString('base64'),
        seconds: captureSeconds,
      },
    )
    const measurement = measure(capture, source)
    await report(testInfo, 'microphone-service-buffer-middle.json', measurement)
    expect(capture.sampleRate).toBe(source.sampleRate)
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
    // A frame a slip falls in reads the wrong pitch, so the largest pitch
    // error is spread over the runs with no slip only, as expectFaithful
    // bounds it: a slip in voice puts one run tens of cents out, and slips
    // come more often under load.
    const unslipped = found.filter(run => run.slips.length === 0)
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
      pitchMaxCents: spread(unslipped.map(run => run.pitch.maxCents)),
    }
    await report(testInfo, 'microphone-twenty-runs.json', {
      variation,
      unslipped: unslipped.length,
      runs,
    })
    for (const run of runs) {
      expectFaithful(run)
    }
    expect(variation.gain.range).toBeLessThan(1e-4)
    expect(variation.snrDb.range).toBeLessThan(3)
    expect(variation.pitchMedianCents.range).toBeLessThan(0.5)
    expect(unslipped.length).toBeGreaterThan(0)
    expect(variation.pitchMaxCents.range).toBeLessThan(2)
    // The start's spread is reported, not bounded: expectFaithful holds each
    // start to the probe's order, and the rest of it is how long the main
    // thread took to connect the source, which grows with the machine's
    // load (docs/fake-microphone.md, "Twenty runs").
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
      { sampleRate: 24000, encoding: 'pcm16', channels: 1, arrives: true },
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
          expectWholeBuffers(measurement.slips)
          // The estimate reads a voice sampled at 8 kHz worse than the
          // device's band-cut copy of it, so this bound is the estimate's
          // own on the 48 kHz voice, not the source's.
          expect(measurement.pitch.medianCents).toBeLessThan(3)
        }
      })
    }
  })
})
