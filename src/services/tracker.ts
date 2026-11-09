import {
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Queue,
  Schema,
  type Scope,
} from 'effect'
import { modelUrls } from 'virtual:intone/models'
import { onnxRuntimeWasmPaths } from 'virtual:intone/onnx-runtime'

import {
  FromTracker,
  type ToTracker,
  type TrackerResult,
  transferables,
} from '../workers/tracker-protocol'

// The tracker during a take: its Worker, with SwiftF0 loaded, from before
// the microphone opens until the take's curve is back. Released, it asks
// the Worker to free the model and close, and terminates it if it does
// not within two seconds.

export type { TrackerResult } from '../workers/tracker-protocol'

export class TrackerError extends Schema.TaggedError<
  TrackerError,
  { readonly brand: unique symbol }
>()('TrackerError', { reason: Schema.String }) {}

export type TrackerSession = Readonly<{
  // The take begins: its batches come at `sampleRate`.
  start: (sampleRate: number) => Effect.Effect<void>
  // One batch of the take, handed over to the Worker.
  push: (batch: Float32Array) => Effect.Effect<void>
  // The take is over: its curve, or why it has none.
  finish: Effect.Effect<TrackerResult, TrackerError>
}>

// The part of a Worker the tracker uses, so tests can stand one in.
export type TrackerWorker = Pick<
  Worker,
  'postMessage' | 'addEventListener' | 'removeEventListener' | 'terminate'
>

export type TrackerAssets = Readonly<{ modelUrl: string; wasmPaths: string }>

// How long a released Worker has to free its model before it is
// terminated anyway.
const closeGrace = Duration.seconds(2)

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const openTrackerWorker = (
  makeWorker: () => TrackerWorker,
  assets: TrackerAssets,
): Effect.Effect<TrackerSession, TrackerError, Scope.Scope> =>
  Effect.gen(function* () {
    const replies = yield* Queue.unbounded<FromTracker>()
    const decode = Schema.decodeUnknownExit(FromTracker)
    const onMessage = (event: MessageEvent): void => {
      Exit.match(decode(event.data), {
        onSuccess: reply => Queue.offerUnsafe(replies, reply),
        onFailure: () =>
          Queue.offerUnsafe(replies, {
            _tag: 'Failed',
            reason: 'The tracker sent a message it should not have.',
          }),
      })
    }
    const onError = (event: Event): void => {
      Queue.offerUnsafe(replies, {
        _tag: 'Failed',
        reason:
          event instanceof ErrorEvent && event.message !== ''
            ? `The tracker stopped: ${event.message}`
            : 'The tracker stopped.',
      })
    }

    const post = (message: ToTracker): Effect.Effect<void> =>
      Effect.sync(() => {
        worker.postMessage(message, [...transferables(message)])
      })

    const nextReply = <A>(
      accept: (reply: FromTracker) => A | undefined,
    ): Effect.Effect<A, TrackerError> =>
      Effect.gen(function* () {
        const reply = yield* Queue.take(replies)
        const accepted = accept(reply)
        if (accepted !== undefined) {
          return accepted
        }
        return yield* new TrackerError({
          reason:
            reply._tag === 'Failed'
              ? reply.reason
              : `The tracker answered ${reply._tag} out of turn.`,
        })
      })

    const worker = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const created = makeWorker()
          created.addEventListener('message', onMessage)
          created.addEventListener('error', onError)
          created.addEventListener('messageerror', onError)
          return created
        },
        catch: error => new TrackerError({ reason: reasonOf(error) }),
      }),
      created =>
        Effect.gen(function* () {
          created.postMessage({ _tag: 'Close' })
          yield* Queue.take(replies).pipe(
            Effect.repeat({ until: reply => reply._tag === 'Closed' }),
            Effect.timeout(closeGrace),
            Effect.ignore,
          )
          created.removeEventListener('message', onMessage)
          created.removeEventListener('error', onError)
          created.removeEventListener('messageerror', onError)
          created.terminate()
        }),
    )

    yield* post({
      _tag: 'Load',
      modelUrl: assets.modelUrl,
      wasmPaths: assets.wasmPaths,
    })
    yield* nextReply(reply => (reply._tag === 'Loaded' ? true : undefined))

    return {
      start: sampleRate => post({ _tag: 'Start', sampleRate }),
      push: samples => post({ _tag: 'Batch', samples }),
      finish: post({ _tag: 'Finish' }).pipe(
        Effect.andThen(
          nextReply<TrackerResult>(reply =>
            reply._tag === 'Tracked' ||
            reply._tag === 'TooQuiet' ||
            reply._tag === 'TooNoisy'
              ? reply
              : undefined,
          ),
        ),
      ),
    }
  })

export class Tracker extends Context.Service<
  Tracker,
  {
    // Starts the tracker Worker and loads SwiftF0, until the scope closes.
    readonly open: Effect.Effect<TrackerSession, TrackerError, Scope.Scope>
  }
>()('intone/services/Tracker') {
  // SwiftF0 in the tracker Worker, the model and ONNX Runtime from the
  // app's own origin through the build's URL maps.
  static readonly layer = Layer.succeed(
    Tracker,
    Tracker.of({
      open: openTrackerWorker(
        () =>
          new Worker(new URL('../workers/tracker.worker.ts', import.meta.url), {
            type: 'module',
            name: 'tracker',
          }),
        { modelUrl: modelUrls['swift-f0'], wasmPaths: onnxRuntimeWasmPaths },
      ),
    }),
  )

  // Answers every take with `respond`'s result for the whole take's
  // samples, with no Worker and no model.
  static readonly layerTest = (
    respond: (samples: Float32Array, sampleRate: number) => TrackerResult,
  ): Layer.Layer<Tracker> =>
    Layer.succeed(
      Tracker,
      Tracker.of({
        open: Effect.sync(() => {
          const parts: Array<Float32Array> = []
          let rate = 0
          return {
            start: sampleRate =>
              Effect.sync(() => {
                rate = sampleRate
              }),
            push: batch =>
              Effect.sync(() => {
                parts.push(batch)
              }),
            finish: Effect.sync(() => {
              const whole = new Float32Array(
                parts.reduce((length, part) => length + part.length, 0),
              )
              parts.reduce((offset, part) => {
                whole.set(part, offset)
                return offset + part.length
              }, 0)
              return respond(whole, rate)
            }),
          }
        }),
      }),
    )
}
