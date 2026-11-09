import { Effect, Fiber, Stream } from 'effect'
import { TestClock } from 'effect/testing'

import { describe, expect, it } from '@effect/vitest'

import type { FromClip, ToClip } from '../workers/clip-protocol'
import {
  ClipAnalyser,
  ClipAnalyserError,
  type ClipBrowser,
  type ClipEvent,
  type ClipWorker,
  analyseWith,
  clipSampleRate,
} from './clip-analyser'

// A stand-in for the clip Worker: it records what it is sent, with what
// was transferred, and answers through `reply`, as the real one would.
const fakeWorker = (reply: (message: ToClip) => ReadonlyArray<FromClip>) => {
  const sent: Array<Readonly<{ message: ToClip; transfer: number }>> = []
  const listeners: Record<string, Array<(event: Event) => void>> = {}
  let terminated = false
  const dispatch = (type: string, event: Event): void => {
    ;(listeners[type] ?? []).forEach(listener => listener(event))
  }
  const worker: ClipWorker = {
    postMessage: (message: ToClip, transfer?: unknown) => {
      sent.push({
        message,
        transfer: Array.isArray(transfer) ? transfer.length : 0,
      })
      reply(message).forEach(data => {
        queueMicrotask(() => {
          dispatch('message', new MessageEvent('message', { data }))
        })
      })
    },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      listeners[type] = [...(listeners[type] ?? []), listener]
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners[type] = (listeners[type] ?? []).filter(
        existing => existing !== listener,
      )
    },
    terminate: () => {
      terminated = true
    },
  }
  return {
    worker,
    sent,
    crash: (message: string) =>
      dispatch('error', new ErrorEvent('error', { message })),
    isTerminated: () => terminated,
  }
}

const tracked = (onset: number): FromClip & { _tag: 'CutDone' } => ({
  _tag: 'CutDone',
  lines: [
    {
      from: 8000,
      to: 40_000,
      curve: {
        _tag: 'Tracked',
        frameHz: 62.5,
        f0Hz: Float32Array.of(0, 120, 121),
        confidence: Float32Array.of(0.1, 0.9, 0.9),
        levelDb: Float32Array.of(-80, -20, -21),
        onsetFrame: onset,
        featureDims: 1,
        features: Float32Array.of(1, 2, 3),
      },
    },
    { from: 48_000, to: 64_000, curve: { _tag: 'TooQuiet' } },
  ],
})

const answering =
  (done: FromClip) =>
  (message: ToClip): ReadonlyArray<FromClip> => {
    if (message._tag === 'Load') {
      return [{ _tag: 'Loaded' }]
    }
    if (message._tag === 'Cut') {
      return [
        { _tag: 'Progress', step: 'FindingLines', done: 50, total: 100 },
        { _tag: 'Progress', step: 'FindingLines', done: 100, total: 100 },
        { _tag: 'Progress', step: 'TrackingLines', done: 2, total: 2 },
        done,
      ]
    }
    return [{ _tag: 'Closed' }]
  }

const assets = {
  speechModelUrl: '/speech',
  pitchModelUrl: '/pitch',
  wasmPaths: '/wasm/',
}

const browserWith = (
  worker: ClipWorker,
  options: Partial<
    Readonly<{ header: number | null; decodedSeconds: number }>
  > = {},
) => {
  const decoded: Array<Blob> = []
  const browser: ClipBrowser = {
    probeSeconds: () => Effect.succeed(options.header ?? 5),
    decode: file =>
      Effect.sync(() => {
        decoded.push(file)
        return new Float32Array((options.decodedSeconds ?? 5) * clipSampleRate)
      }),
    makeWorker: () => worker,
    assets,
  }
  return { browser, decoded }
}

const file = new Blob([new Uint8Array(16)], { type: 'audio/wav' })

describe('analyseWith', () => {
  it.effect(
    'checks the file, decodes it, and cuts it in the Worker, step by step',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering(tracked(1)))
        const { browser } = browserWith(fake.worker)
        const events = yield* Stream.runCollect(analyseWith(browser)(file))
        expect(events.map(event => event._tag)).toStrictEqual([
          'Checking',
          'Decoding',
          'FindingLines',
          'FindingLines',
          'TrackingLines',
          'Analysed',
        ])
        const analysed = events.at(-1)
        expect(analysed).toMatchObject({
          _tag: 'Analysed',
          seconds: 5,
          lines: [
            { from: 0.5, to: 2.5, native: { _tag: 'Tracked' } },
            { from: 3, to: 4, native: { _tag: 'TooQuiet' } },
          ],
        })
        expect(fake.sent.map(({ message }) => message._tag)).toStrictEqual([
          'Load',
          'Cut',
          'Close',
        ])
        expect(fake.sent[0]?.message).toStrictEqual({ _tag: 'Load', ...assets })
        expect(fake.sent[1]?.transfer).toBe(1)
        expect(fake.isTerminated()).toBe(true)
      }),
  )

  it.effect(
    'gives each line its curve and features as the score reads them',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering(tracked(1)))
        const events = yield* Stream.runCollect(
          analyseWith(browserWith(fake.worker).browser)(file),
        )
        const analysed = events.at(-1)
        if (analysed?._tag !== 'Analysed') {
          throw new Error('not analysed')
        }
        const native = analysed.lines[0]?.native
        if (native?._tag !== 'Tracked') {
          throw new Error('not tracked')
        }
        expect(native.recording.curve.onsetFrame).toBe(1)
        expect(Array.from(native.recording.curve.f0Hz)).toStrictEqual([
          0, 120, 121,
        ])
        expect(native.recording.features).toStrictEqual({
          frameHz: 62.5,
          dims: 1,
          data: Float32Array.of(1, 2, 3),
        })
      }),
  )

  it.effect(
    'refuses a clip over ten minutes by its header, before decoding it',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering(tracked(1)))
        const { browser, decoded } = browserWith(fake.worker, { header: 601 })
        const error = yield* Stream.runCollect(analyseWith(browser)(file)).pipe(
          Effect.flip,
        )
        expect(error).toBeInstanceOf(ClipAnalyserError)
        expect(error.failure).toBe('TooLong')
        expect(error.reason).toContain('10:01')
        expect(decoded).toHaveLength(0)
        expect(fake.sent).toHaveLength(0)
      }),
  )

  it.effect(
    'refuses a clip over ten minutes once decoded when its header does not say',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering(tracked(1)))
        const { browser, decoded } = browserWith(fake.worker, {
          header: null,
          decodedSeconds: 640,
        })
        const error = yield* Stream.runCollect(analyseWith(browser)(file)).pipe(
          Effect.flip,
        )
        expect(error.failure).toBe('TooLong')
        expect(decoded).toHaveLength(1)
        expect(fake.sent).toHaveLength(0)
      }),
  )

  it.effect('a clip of exactly ten minutes is cut', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(answering(tracked(1)))
      const { browser } = browserWith(fake.worker, {
        header: 600,
        decodedSeconds: 600,
      })
      const events = yield* Stream.runCollect(analyseWith(browser)(file))
      expect(events.at(-1)?._tag).toBe('Analysed')
    }),
  )

  it.effect('says when the file has no speech in it', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(answering({ _tag: 'CutDone', lines: [] }))
      const error = yield* Stream.runCollect(
        analyseWith(browserWith(fake.worker).browser)(file),
      ).pipe(Effect.flip)
      expect(error.failure).toBe('NoSpeech')
      expect(fake.isTerminated()).toBe(true)
    }),
  )

  it.effect('passes on why the file could not be read', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(answering(tracked(1)))
      const browser: ClipBrowser = {
        ...browserWith(fake.worker).browser,
        probeSeconds: () =>
          Effect.fail(
            new ClipAnalyserError({
              failure: 'Unsupported',
              reason: 'This browser cannot play it.',
            }),
          ),
      }
      const error = yield* Stream.runCollect(analyseWith(browser)(file)).pipe(
        Effect.flip,
      )
      expect(error.failure).toBe('Unsupported')
      expect(fake.sent).toHaveLength(0)
    }),
  )

  it.effect('fails with the reason the Worker gives, and releases it', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(
        answering({ _tag: 'Failed', reason: 'The speech model did not load' }),
      )
      const error = yield* Stream.runCollect(
        analyseWith(browserWith(fake.worker).browser)(file),
      ).pipe(Effect.flip)
      expect(error.failure).toBe('Failed')
      expect(error.reason).toBe('The speech model did not load')
      expect(fake.isTerminated()).toBe(true)
    }),
  )

  it.effect('fails when the Worker crashes', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(message =>
        message._tag === 'Load' ? [{ _tag: 'Loaded' }] : [],
      )
      const fiber = yield* Stream.runCollect(
        analyseWith(browserWith(fake.worker).browser)(file),
      ).pipe(Effect.flip, Effect.forkChild)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      fake.crash('out of memory')
      yield* TestClock.adjust('2 seconds')
      const error = yield* Fiber.join(fiber)
      expect(error.reason).toBe('The clip analyser stopped: out of memory')
    }),
  )

  it.effect(
    'interrupting the cut asks the Worker to close, and terminates it',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(message =>
          message._tag === 'Load'
            ? [{ _tag: 'Loaded' }]
            : message._tag === 'Cut'
              ? [{ _tag: 'Progress', step: 'FindingLines', done: 1, total: 9 }]
              : [{ _tag: 'Closed' }],
        )
        const heard: Array<ClipEvent> = []
        const fiber = yield* analyseWith(browserWith(fake.worker).browser)(
          file,
        ).pipe(
          Stream.runForEach(event => Effect.sync(() => heard.push(event))),
          Effect.forkChild,
        )
        while (!heard.some(event => event._tag === 'FindingLines')) {
          yield* Effect.yieldNow
        }
        yield* Fiber.interrupt(fiber)
        expect(fake.sent.at(-1)?.message._tag).toBe('Close')
        expect(fake.isTerminated()).toBe(true)
      }),
  )

  it.effect('terminates a Worker that does not close within two seconds', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(message =>
        message._tag === 'Load' ? [{ _tag: 'Loaded' }] : [],
      )
      const fiber = yield* analyseWith(browserWith(fake.worker).browser)(
        file,
      ).pipe(Stream.runDrain, Effect.forkChild)
      while (!fake.sent.some(({ message }) => message._tag === 'Cut')) {
        yield* Effect.yieldNow
      }
      const interrupting = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(fake.isTerminated()).toBe(false)
      yield* TestClock.adjust('2 seconds')
      yield* Fiber.join(interrupting)
      expect(fake.isTerminated()).toBe(true)
    }),
  )
})

describe('ClipAnalyser.layerTest', () => {
  it.effect('answers with the events it is given', () =>
    Effect.gen(function* () {
      const analyser = yield* ClipAnalyser
      const events = yield* Stream.runCollect(analyser.analyse(file))
      expect(events).toStrictEqual([{ _tag: 'Checking' }, { _tag: 'Decoding' }])
    }).pipe(
      Effect.provide(
        ClipAnalyser.layerTest(() => [
          { _tag: 'Checking' },
          { _tag: 'Decoding' },
        ]),
      ),
    ),
  )
})
