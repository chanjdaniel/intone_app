import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'

import { ensureCached, readModelList } from '../../build/models.ts'
import { decodeWav } from '../../src/engine/audio/wav.ts'
import { createLiveTracker } from '../../src/engine/pitch/live.ts'
import { createResampler, resample } from '../../src/engine/pitch/resample.ts'
import type { SwiftF0Inference } from '../../src/engine/pitch/swift-f0.ts'
import { analyseTake } from '../../src/engine/pitch/take.ts'
import { openSwiftF0 } from '../../src/workers/swift-f0-session.ts'
import { pitchError } from '../support/pitch.ts'
import { root } from '../support/run.ts'
import {
  type SyntheticVoiceLabels,
  voiceNames,
  voicedFramesAwayFromEdges,
} from '../support/synthetic-voice.ts'

// The tracker's own code, start to finish, on the real SwiftF0 model in
// ONNX Runtime Web's WebAssembly (here under Node): each synthetic voice
// resampled from 48 kHz to 16 kHz, tracked, gated, and compared with the
// F0 it was made from. The browser runs the same code in the tracker
// Worker; tests/e2e/take.spec.ts checks the curve it draws there.

const fixtures = join(root, 'fixtures', 'synthetic')
let model = new Uint8Array(0)

beforeAll(async () => {
  const list = await readModelList(join(root, 'models.json'))
  const swiftF0 = list.find(entry => entry.id === 'swift-f0')
  if (swiftF0 === undefined) {
    throw new Error('models.json lists no swift-f0')
  }
  model = readFileSync(
    await ensureCached(swiftF0, join(root, '.cache', 'models')),
  )
})

// Runs `use` with a SwiftF0 session that is released after it.
const withSwiftF0 = <A>(
  use: (infer: SwiftF0Inference) => Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const run = yield* openSwiftF0(model)
        const runPromise = Effect.runPromiseWith(yield* Effect.context())
        return yield* Effect.promise(() =>
          use((samples, minHz, maxHz) =>
            runPromise(run(samples, minHz, maxHz)),
          ),
        )
      }),
    ),
  )

const readLabels = (name: string): SyntheticVoiceLabels =>
  JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8'))

const readVoice = (name: string) => ({
  wav: decodeWav(readFileSync(join(fixtures, `${name}.wav`))),
  labels: readLabels(name),
})

describe('the tracker on SwiftF0', () => {
  test.each(voiceNames)(
    'follows the %s voice within a few cents, from its onset',
    async name => {
      const { wav, labels } = readVoice(name)
      const samples = wav.channels[0] ?? new Float32Array(0)
      const analysis = await withSwiftF0(infer =>
        analyseTake(resample(samples, wav.sampleRate, 16_000), infer),
      )

      expect(analysis._tag).toBe('Tracked')
      if (analysis._tag !== 'Tracked') {
        return
      }
      const { curve } = analysis
      expect(analysis.gainDb).toBe(0)
      expect(curve.frameHz).toBe(labels.frameHz)

      const frames = voicedFramesAwayFromEdges(labels)
      const error = pitchError(
        Array.from(curve.f0Hz, hz => (hz > 0 ? hz : Number.NaN)),
        labels.f0Hz,
        frames,
      )
      expect(error.missing).toBeLessThanOrEqual(1)
      expect(error.medianCents).toBeLessThan(10)
      expect(error.p95Cents).toBeLessThan(30)

      // The voice starts at 0.5 s, frame 31.25.
      expect(curve.onsetFrame).toBeGreaterThanOrEqual(30)
      expect(curve.onsetFrame).toBeLessThanOrEqual(34)
      // Nothing voiced in the half second of silence before it, or after
      // the voice ends at 1.9 s.
      expect(curve.f0Hz.subarray(0, 29).every(hz => hz === 0)).toBe(true)
      expect(curve.f0Hz.subarray(123).every(hz => hz === 0)).toBe(true)
    },
  )

  test('scales a quiet take up and tracks it as well', async () => {
    const { wav, labels } = readVoice('middle')
    // -46 dBFS peak, 40 dB under the file.
    const quiet = (wav.channels[0] ?? new Float32Array(0)).map(x => x / 100)
    const analysis = await withSwiftF0(infer =>
      analyseTake(resample(quiet, wav.sampleRate, 16_000), infer),
    )
    expect(analysis._tag).toBe('Tracked')
    if (analysis._tag === 'Tracked') {
      expect(analysis.gainDb).toBeGreaterThan(25)
      const error = pitchError(
        Array.from(analysis.curve.f0Hz, hz => (hz > 0 ? hz : Number.NaN)),
        labels.f0Hz,
        voicedFramesAwayFromEdges(labels),
      )
      expect(error.missing).toBeLessThanOrEqual(1)
      expect(error.medianCents).toBeLessThan(10)
    }
  })

  test.each(voiceNames)(
    'gives the %s voice live, batch by batch, the frames its whole take gives',
    async name => {
      const { wav } = readVoice(name)
      const samples = wav.channels[0] ?? new Float32Array(0)
      const { live, whole } = await withSwiftF0(async infer => {
        // As the tracker Worker hears a take: 20 ms batches at 48 kHz,
        // resampled as they come.
        const resampler = createResampler(wav.sampleRate, 16_000)
        const tracker = createLiveTracker(infer)
        const frames: Array<number> = []
        const batch = wav.sampleRate / 50
        for (let start = 0; start < samples.length; start += batch) {
          const tracked = await tracker.push(
            resampler.push(samples.subarray(start, start + batch)),
          )
          frames.push(...(tracked?.f0Hz ?? []))
        }
        frames.push(
          ...((await tracker.push(resampler.flush()))?.f0Hz ?? []),
          ...((await tracker.flush())?.f0Hz ?? []),
        )
        return {
          live: frames,
          whole: await analyseTake(
            resample(samples, wav.sampleRate, 16_000),
            infer,
          ),
        }
      })
      expect(whole._tag).toBe('Tracked')
      if (whole._tag !== 'Tracked') {
        return
      }
      expect(live.length).toBe(whole.curve.f0Hz.length)
      const differences = live.map((hz, frame) =>
        Math.abs(hz - (whole.curve.f0Hz[frame] ?? Number.NaN)),
      )
      expect(Math.max(...differences)).toBeLessThan(0.01)
    },
  )
})
