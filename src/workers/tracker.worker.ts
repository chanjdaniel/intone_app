import { Effect, Exit, Match, Queue, Schema, Scope, Stream } from 'effect'

import { type Resampler, createResampler } from '../engine/pitch/resample'
import {
  type SwiftF0Inference,
  swiftF0SampleRate,
} from '../engine/pitch/swift-f0'
import { analyseTake } from '../engine/pitch/take'
import { openSwiftF0 } from './swift-f0-session'
import { type FromTracker, ToTracker, transferables } from './tracker-protocol'

// The tracker Worker: one take's audio in, its curve out. It loads SwiftF0
// inside a scope on `Load`, learns the take's rate on `Start`, resamples
// each `Batch` to 16 kHz as it comes,
// tracks the whole take on `Finish`, and on `Close` releases the model,
// says `Closed` and closes itself. Tracking never runs on the main thread.

const post = (message: FromTracker): Effect.Effect<void> =>
  Effect.sync(() => {
    self.postMessage(message, { transfer: [...transferables(message)] })
  })

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

class ModelFetchError extends Schema.TaggedError<
  ModelFetchError,
  { readonly brand: unique symbol }
>()('ModelFetchError', { reason: Schema.String }) {}

class TrackError extends Schema.TaggedError<
  TrackError,
  { readonly brand: unique symbol }
>()('TrackError', { reason: Schema.String }) {}

// Every message the page sends, in order, until the Worker closes.
const incoming = Stream.callback<unknown>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const listener = (event: MessageEvent): void => {
        Queue.offerUnsafe(queue, event.data)
      }
      self.addEventListener('message', listener)
      return listener
    }),
    listener =>
      Effect.sync(() => {
        self.removeEventListener('message', listener)
      }),
  ),
)

const fetchModel = (url: string): Effect.Effect<Uint8Array, ModelFetchError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`the server answered ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
    catch: error =>
      new ModelFetchError({
        reason: `The pitch model did not load: ${reasonOf(error)}`,
      }),
  })

const concatenate = (parts: ReadonlyArray<Float32Array>): Float32Array => {
  const whole = new Float32Array(
    parts.reduce((length, part) => length + part.length, 0),
  )
  parts.reduce((offset, part) => {
    whole.set(part, offset)
    return offset + part.length
  }, 0)
  return whole
}

type Take = {
  infer: SwiftF0Inference | null
  resampler: Resampler | null
  parts: Array<Float32Array>
  finished: boolean
}

const program = Effect.gen(function* () {
  const modelScope = yield* Scope.make()
  const take: Take = {
    infer: null,
    resampler: null,
    parts: [],
    finished: false,
  }

  const load = (message: Extract<ToTracker, { _tag: 'Load' }>) =>
    Effect.gen(function* () {
      const model = yield* fetchModel(message.modelUrl)
      const run = yield* openSwiftF0(model, message.wasmPaths).pipe(
        Scope.provide(modelScope),
      )
      const runPromise = Effect.runPromiseWith(yield* Effect.context())
      take.infer = (samples, minHz, maxHz) =>
        runPromise(run(samples, minHz, maxHz))
      yield* post({ _tag: 'Loaded' })
    })

  const finish = Effect.gen(function* () {
    const { infer, resampler } = take
    if (infer === null || resampler === null || take.finished) {
      return yield* post({
        _tag: 'Failed',
        reason: 'There is no take to track.',
      })
    }
    take.finished = true
    take.parts.push(resampler.flush())
    const samples = concatenate(take.parts)
    take.parts = []
    if (samples.length === 0) {
      return yield* post({ _tag: 'TooQuiet', peakDb: -140 })
    }
    const analysis = yield* Effect.tryPromise({
      try: () => analyseTake(samples, infer),
      catch: error => new TrackError({ reason: reasonOf(error) }),
    })
    if (analysis._tag === 'Tracked') {
      return yield* post({
        _tag: 'Tracked',
        frameHz: analysis.curve.frameHz,
        f0Hz: analysis.curve.f0Hz,
        confidence: analysis.curve.confidence,
        levelDb: analysis.curve.levelDb,
        onsetFrame: analysis.curve.onsetFrame,
        peakDb: analysis.peakDb,
        gainDb: analysis.gainDb,
      })
    }
    return yield* post(analysis)
  })

  const handle = (message: ToTracker): Effect.Effect<void> =>
    Match.value(message).pipe(
      Match.tagsExhaustive({
        Load: load,
        Start: ({ sampleRate }) =>
          Effect.sync(() => {
            if (take.resampler === null) {
              take.resampler = createResampler(sampleRate, swiftF0SampleRate)
            }
          }),
        Batch: ({ samples }) =>
          Effect.sync(() => {
            if (take.resampler !== null && !take.finished) {
              take.parts.push(take.resampler.push(samples))
            }
          }),
        Finish: () => finish,
        Close: () => Effect.void,
      }),
      Effect.catch(error => post({ _tag: 'Failed', reason: error.reason })),
    )

  yield* incoming.pipe(
    Stream.mapEffect(data =>
      Schema.decodeUnknownEffect(ToTracker)(data).pipe(
        Effect.tap(handle),
        Effect.catchTag('SchemaError', error =>
          post({ _tag: 'Failed', reason: error.message }).pipe(Effect.as(null)),
        ),
      ),
    ),
    Stream.takeUntil(message => message?._tag === 'Close'),
    Stream.runDrain,
  )

  yield* Scope.close(modelScope, Exit.void)
  yield* post({ _tag: 'Closed' })
  self.close()
})

Effect.runFork(Effect.scoped(program))
