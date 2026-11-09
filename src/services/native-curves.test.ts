import { Effect, Layer } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { encodeWav } from '../engine/audio/wav'
import { CurveCache, storedCurveOf } from './curve-cache'
import {
  type LineAudio,
  NativeCurveError,
  NativeCurves,
  cacheKeyOf,
  fetchLineAudio,
} from './native-curves'
import { Tracker, type TrackerResult } from './tracker'

const line = { key: 'ame-ga-suki/1', audioUrl: '/assets/right-abc.wav' }

const tracked = (samples: Float32Array): TrackerResult => ({
  _tag: 'Tracked',
  frameHz: 62.5,
  f0Hz: Float32Array.of(0, 200, 210, samples.length),
  confidence: Float32Array.of(0, 0.9, 0.9, 0.9),
  levelDb: Float32Array.of(-80, -20, -20, -20),
  onsetFrame: 1,
  peakDb: -6,
  gainDb: 0,
})

// The services with `respond` as the tracker, an in-memory cache, and a
// line whose audio is 480 samples at 24 kHz.
const harness = (respond: (samples: Float32Array) => TrackerResult) => {
  const records = new Map<string, unknown>()
  const tracked: Array<Readonly<{ samples: number; sampleRate: number }>> = []
  const loads: Array<string> = []
  const loadAudio = (url: string) =>
    Effect.sync((): LineAudio => {
      loads.push(url)
      return { samples: new Float32Array(480).fill(0.1), sampleRate: 24_000 }
    })
  const layer = NativeCurves.make(
    loadAudio,
    '/models/swift-f0/1234/model.onnx',
  ).pipe(
    Layer.provide([
      Tracker.layerTest((samples, sampleRate) => {
        tracked.push({ samples: samples.length, sampleRate })
        return respond(samples)
      }),
      CurveCache.layerMemory(records),
    ]),
  )
  const curveOf = NativeCurves.use(native => native.curveOf(line)).pipe(
    Effect.provide(layer),
  )
  return { records, tracked, loads, curveOf }
}

describe('a line’s native curve', () => {
  it.effect(
    'is tracked from the line’s audio by the take’s tracker, then kept',
    () =>
      Effect.gen(function* () {
        const { records, tracked: runs, loads, curveOf } = harness(tracked)
        const curve = yield* curveOf
        expect(runs).toStrictEqual([{ samples: 480, sampleRate: 24_000 }])
        expect(loads).toStrictEqual([line.audioUrl])
        expect(Array.from(curve.f0Hz)).toStrictEqual([0, 200, 210, 480])
        expect(curve.onsetFrame).toBe(1)
        expect([...records.keys()]).toStrictEqual([
          cacheKeyOf(line, '/models/swift-f0/1234/model.onnx'),
        ])
      }),
  )

  it.effect('is read from the device after its first run', () =>
    Effect.gen(function* () {
      const { tracked: runs, loads, curveOf } = harness(tracked)
      const first = yield* curveOf
      const second = yield* curveOf
      expect(runs).toHaveLength(1)
      expect(loads).toHaveLength(1)
      expect(second).toStrictEqual(first)
    }),
  )

  it.effect('is tracked again when the kept record does not decode', () =>
    Effect.gen(function* () {
      const { records, tracked: runs, curveOf } = harness(tracked)
      const key = cacheKeyOf(line, '/models/swift-f0/1234/model.onnx')
      records.set(key, { format: 0, f0Hz: [1, 2, 3] })
      yield* curveOf
      expect(runs).toHaveLength(1)
      const stored = yield* curveOf
      expect(records.get(key)).toStrictEqual(storedCurveOf(stored))
    }),
  )

  it('is keyed by the line, its audio and the tracker', () => {
    const key = cacheKeyOf(line, 'a')
    expect(cacheKeyOf(line, 'b')).not.toBe(key)
    expect(
      cacheKeyOf({ ...line, audioUrl: '/assets/right-def.wav' }, 'a'),
    ).not.toBe(key)
    expect(cacheKeyOf({ ...line, key: 'ame-ga-suki/2' }, 'a')).not.toBe(key)
  })

  it.effect('fails, keeping nothing, when the line is too quiet to track', () =>
    Effect.gen(function* () {
      const { records, curveOf } = harness(() => ({
        _tag: 'TooQuiet',
        peakDb: -70,
      }))
      const error = yield* Effect.flip(curveOf)
      expect(error).toBeInstanceOf(NativeCurveError)
      expect(error.reason).toBe(
        'The line could not be tracked: it was too quiet.',
      )
      expect(records.size).toBe(0)
    }),
  )
})

describe('fetching a line’s audio', () => {
  it.effect('decodes the WAV and mixes it to mono', () =>
    Effect.gen(function* () {
      const bytes = encodeWav({
        sampleRate: 24_000,
        encoding: 'float32',
        channels: [Float32Array.of(0.5, 0.25), Float32Array.of(0.25, 0.25)],
      })
      const fetched = yield* fetchLineAudio(
        `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`,
      )
      expect(fetched.sampleRate).toBe(24_000)
      expect(Array.from(fetched.samples)).toStrictEqual([0.375, 0.25])
    }),
  )
})
