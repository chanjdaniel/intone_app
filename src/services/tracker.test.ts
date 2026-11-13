import { Effect, Exit, Fiber, Scope, Stream } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import type { FromTracker, ToTracker } from '../workers/tracker-protocol'
import { Tracker, type TrackerWorker, openTrackerWorker } from './tracker'

// A stand-in for the tracker Worker: it records what it is sent, with what
// was transferred, and answers through `reply`, as the real one would.
const fakeWorker = (reply: (message: ToTracker) => ReadonlyArray<unknown>) => {
  const sent: Array<Readonly<{ message: ToTracker; transfer: number }>> = []
  const listeners: Record<string, Array<(event: Event) => void>> = {}
  let terminated = false
  const dispatch = (type: string, event: Event): void => {
    ;(listeners[type] ?? []).forEach(listener => listener(event))
  }
  const worker: TrackerWorker = {
    postMessage: (message: ToTracker, transfer?: unknown) => {
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

const tracked: FromTracker = {
  _tag: 'Tracked',
  frameHz: 62.5,
  f0Hz: Float32Array.of(0, 120, 121),
  confidence: Float32Array.of(0.1, 0.9, 0.9),
  levelDb: Float32Array.of(-80, -20, -21),
  onsetFrame: 1,
  peakDb: -6,
  gainDb: 0,
  featureDims: 2,
  features: Float32Array.of(1, 2, 3, 4, 5, 6),
}

const assets = { modelUrl: '/model/url', wasmPaths: '/wasm/' }

const answering = (message: ToTracker): ReadonlyArray<unknown> => {
  if (message._tag === 'Load') {
    return [{ _tag: 'Loaded' }]
  }
  if (message._tag === 'Finish') {
    return [tracked]
  }
  if (message._tag === 'Close') {
    return [{ _tag: 'Closed' }]
  }
  return []
}

describe('openTrackerWorker', () => {
  it.effect(
    'loads the model from the given URLs, hands batches over, and returns the curve',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering)
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const session = yield* openTrackerWorker(() => fake.worker, assets)
            yield* session.start(48_000)
            yield* session.push(new Float32Array(960))
            yield* session.push(new Float32Array(960))
            return yield* session.finish
          }),
        )
        expect(result).toStrictEqual(tracked)
        expect(fake.sent.map(({ message }) => message._tag)).toStrictEqual([
          'Load',
          'Start',
          'Batch',
          'Batch',
          'Finish',
          'Close',
        ])
        expect(fake.sent[0]?.message).toStrictEqual({
          _tag: 'Load',
          modelUrl: '/model/url',
          wasmPaths: '/wasm/',
        })
        expect(fake.sent[1]?.message).toStrictEqual({
          _tag: 'Start',
          sampleRate: 48_000,
        })
        // Each batch's buffer is transferred, not copied.
        expect(fake.sent[2]?.transfer).toBe(1)
        expect(fake.isTerminated()).toBe(true)
      }),
  )

  it.effect('fails to open when the Worker cannot load the model', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(message =>
        message._tag === 'Load'
          ? [{ _tag: 'Failed', reason: 'The pitch model did not load: 404' }]
          : answering(message),
      )
      const exit = yield* Effect.exit(
        Effect.scoped(openTrackerWorker(() => fake.worker, assets)),
      )
      expect(exit).toStrictEqual(
        Exit.fail(
          expect.objectContaining({
            _tag: 'TrackerError',
            reason: 'The pitch model did not load: 404',
          }),
        ),
      )
      expect(fake.isTerminated()).toBe(true)
    }),
  )

  it.effect('fails the take when the Worker stops', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(message =>
        message._tag === 'Finish' ? [] : answering(message),
      )
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const session = yield* openTrackerWorker(() => fake.worker, assets)
            yield* Effect.sync(() => {
              queueMicrotask(() => fake.crash('out of memory'))
            })
            return yield* session.finish
          }),
        ),
      )
      expect(exit).toStrictEqual(
        Exit.fail(
          expect.objectContaining({
            reason: 'The tracker stopped: out of memory',
          }),
        ),
      )
    }),
  )

  it.effect(
    'releases the Worker when the take is abandoned, freeing its model first',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering)
        const scope = yield* Scope.make()
        yield* openTrackerWorker(() => fake.worker, assets).pipe(
          Scope.provide(scope),
        )
        expect(fake.isTerminated()).toBe(false)
        yield* Scope.close(scope, Exit.void)
        expect(fake.sent.at(-1)?.message._tag).toBe('Close')
        expect(fake.isTerminated()).toBe(true)
      }),
  )

  // On the real clock: the Worker gets two seconds to close.
  it.live(
    'terminates a Worker that does not close in time',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(message =>
          message._tag === 'Close' ? [] : answering(message),
        )
        yield* Effect.scoped(openTrackerWorker(() => fake.worker, assets))
        expect(fake.isTerminated()).toBe(true)
      }),
    { timeout: 5_000 },
  )
})

// A Worker that answers each batch with the frame it completes, and the
// end of the take with its last frame, the end of the frames and the curve.
const answeringFrames = (message: ToTracker): ReadonlyArray<unknown> => {
  if (message._tag === 'Batch') {
    return [
      {
        _tag: 'Frames',
        firstFrame: message.samples[0] ?? 0,
        f0Hz: Float32Array.of(100 + (message.samples[0] ?? 0)),
      },
    ]
  }
  if (message._tag === 'Finish') {
    return [
      { _tag: 'Frames', firstFrame: 3, f0Hz: Float32Array.of(0, 0) },
      { _tag: 'FramesEnded' },
      tracked,
    ]
  }
  return answering(message)
}

const framesOf = (
  frames: ReadonlyArray<Readonly<{ firstFrame: number; f0Hz: Float32Array }>>,
) => frames.map(({ firstFrame, f0Hz }) => [firstFrame, Array.from(f0Hz)])

describe("the take's frames", () => {
  it.effect(
    'come as the Worker finds them, from the first to a late subscriber, and end with the take',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answeringFrames)
        const { early, late, result } = yield* Effect.scoped(
          Effect.gen(function* () {
            const session = yield* openTrackerWorker(() => fake.worker, assets)
            const early = yield* Stream.runCollect(session.frames).pipe(
              Effect.forkChild,
            )
            yield* session.start(48_000)
            yield* session.push(Float32Array.of(0))
            yield* session.push(Float32Array.of(1))
            yield* session.push(Float32Array.of(2))
            const result = yield* session.finish
            const late = yield* Stream.runCollect(session.frames)
            return { early: yield* Fiber.join(early), late, result }
          }),
        )
        const expected = [
          [0, [100]],
          [1, [101]],
          [2, [102]],
          [3, [0, 0]],
        ]
        expect(framesOf(early)).toStrictEqual(expected)
        expect(framesOf(late)).toStrictEqual(expected)
        // The frames never reach the replies the take waits on.
        expect(result).toStrictEqual(tracked)
      }),
  )

  it.effect('end when the Worker stops', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(answeringFrames)
      const frames = yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openTrackerWorker(() => fake.worker, assets)
          yield* session.start(48_000)
          yield* session.push(Float32Array.of(0))
          yield* Effect.sync(() => {
            queueMicrotask(() => fake.crash('out of memory'))
          })
          return yield* Stream.runCollect(session.frames)
        }),
      )
      expect(framesOf(frames)).toStrictEqual([[0, [100]]])
    }),
  )

  it.effect('end when the tracker is released mid-take', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(answering)
      const scope = yield* Scope.make()
      const session = yield* openTrackerWorker(() => fake.worker, assets).pipe(
        Scope.provide(scope),
      )
      const frames = yield* Stream.runCollect(session.frames).pipe(
        Effect.forkChild,
      )
      yield* Scope.close(scope, Exit.void)
      expect(yield* Fiber.join(frames)).toStrictEqual([])
    }),
  )
})

describe('Tracker.layerTest', () => {
  it.effect('answers with its function of the whole take', () =>
    Effect.gen(function* () {
      const tracker = yield* Tracker
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* tracker.open
          yield* session.start(16_000)
          yield* session.push(Float32Array.of(1, 2))
          yield* session.push(Float32Array.of(3))
          return yield* session.finish
        }),
      )
      expect(result).toStrictEqual({ _tag: 'TooQuiet', peakDb: 3 })
    }).pipe(
      Effect.provide(
        Tracker.layerTest((samples, sampleRate) => ({
          _tag: 'TooQuiet',
          peakDb: sampleRate === 16_000 ? (samples[2] ?? 0) : 0,
        })),
      ),
    ),
  )
})
