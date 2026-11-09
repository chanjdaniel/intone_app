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

import { type WavEncoding, decodeWav, encodeWav } from '../../src/engine/audio/wav.ts'
import { type Comparison, compareWithSource } from '../support/audio-compare.ts'
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

const measure = (capture: Capture, source: Source): Measurement | null => {
  const received = samplesOf(capture)
  const comparison = compareWithSource(
    received,
    capture.sampleRate,
    source.samples,
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
      estimatePitch(
        received,
        capture.sampleRate,
        frameHz,
        comparison.delaySeconds,
      ),
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
  options: { sampleRate?: number; browserProcessing?: boolean } = {},
): Promise<Capture> =>
  withFakeMicrophone(browserType, file, page =>
    page.evaluate(
      request => window.intoneProbe.fromMicrophone(request),
      {
        seconds: captureSeconds,
        sampleRate: options.sampleRate ?? 48000,
        browserProcessing: options.browserProcessing ?? false,
      },
    ),
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

// What every faithful path must deliver, from a 16-bit source: its own
// gain, nothing added beyond 16-bit quantisation and resampling, and a
// pitch estimate as close to the known curve as the source's own.
const expectFaithful = (measurement: Measurement | null): void => {
  expect(measurement).not.toBeNull()
  if (measurement === null) {
    return
  }
  expect(measurement.gain).toBeGreaterThan(0.999)
  expect(measurement.gain).toBeLessThan(1.001)
  expect(measurement.snrDb).toBeGreaterThan(70)
  expect(measurement.pitch.missing).toBeLessThanOrEqual(
    measurement.sourcePitch.missing,
  )
  expect(measurement.pitch.medianCents).toBeLessThan(
    measurement.sourcePitch.medianCents + 0.5,
  )
  expect(measurement.pitch.maxCents).toBeLessThan(
    measurement.sourcePitch.maxCents + 2,
  )
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
      const capture = await recordThroughMicrophone(playwright.chromium, source.file)
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
      // The device's file starts at getUserMedia, before the worklet hears
      // it; the probe readies the worklet first, as the app does.
      expect(measurement?.delaySeconds).toBeGreaterThan(-0.03)
      expect(measurement?.delaySeconds).toBeLessThan(0.03)
    })
  }

  test('agrees with itself over twenty runs', async ({
    playwright,
  }, testInfo) => {
    test.setTimeout(240_000)
    const source = fixture('middle')
    const runs: Array<Measurement> = []
    for (let run = 0; run < 20; run++) {
      const measurement = measure(
        await recordThroughMicrophone(playwright.chromium, source.file),
        source,
      )
      expectFaithful(measurement)
      if (measurement !== null) {
        runs.push(measurement)
      }
    }
    const spread = (values: ReadonlyArray<number>) => ({
      min: Math.min(...values),
      max: Math.max(...values),
      range: Math.max(...values) - Math.min(...values),
    })
    const variation = {
      delaySeconds: spread(runs.map(run => run.delaySeconds)),
      gain: spread(runs.map(run => run.gain)),
      snrDb: spread(runs.map(run => run.snrDb)),
      pitchMedianCents: spread(runs.map(run => run.pitch.medianCents)),
      pitchMaxCents: spread(runs.map(run => run.pitch.maxCents)),
    }
    await report(testInfo, 'microphone-twenty-runs.json', { variation, runs })
    expect(runs).toHaveLength(20)
    expect(variation.gain.range).toBeLessThan(1e-4)
    expect(variation.snrDb.range).toBeLessThan(3)
    expect(variation.pitchMedianCents.range).toBeLessThan(0.5)
    expect(variation.pitchMaxCents.range).toBeLessThan(2)
    expect(variation.delaySeconds.range).toBeLessThan(0.025)
  })

  test('alters the audio when the browser processing is left on', async ({
    playwright,
  }, testInfo) => {
    const source = fixture('middle')
    const capture = await recordThroughMicrophone(playwright.chromium, source.file, {
      browserProcessing: true,
    })
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
    }>
    // Each format the fake device was given, and whether its audio arrived.
    const formats: ReadonlyArray<Format & { arrives: boolean }> = [
      { sampleRate: 8000, encoding: 'pcm16', channels: 1, arrives: true },
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
      test(`${label} ${format.arrives ? 'arrives' : 'arrives as silence'}`, async ({
        playwright,
      }, testInfo) => {
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
        )
        await report(testInfo, `format-${label}.json`, measurement)
        expect(measurement !== null).toBe(format.arrives)
        if (measurement !== null) {
          expect(measurement.gain).toBeGreaterThan(0.99)
          expect(measurement.gain).toBeLessThan(1.01)
          expect(measurement.pitch.medianCents).toBeLessThan(
            measurement.sourcePitch.medianCents + 0.5,
          )
        }
      })
    }
  })
})
