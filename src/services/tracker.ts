import {
  Context,
  Effect,
  Exit,
  Layer,
  PubSub,
  Schema,
  type Scope,
  Stream,
  type Take,
} from 'effect'
import { modelUrls } from 'virtual:intone/models'
import { onnxRuntimeWasmPaths } from 'virtual:intone/onnx-runtime'

import type { LiveFrames } from '../engine/pitch/live'
import type { Recording } from '../score/score'
import { recordingOfPayload } from '../workers/recording-payload'
import {
  FromTracker,
  type ToTracker,
  type TrackerResult,
  transferables,
} from '../workers/tracker-protocol'
import { type WorkerPort, openWorkerSession } from './worker-session'

// The tracker during a take: its Worker, with SwiftF0 loaded, from before
// the microphone opens until the take's curve is back. While the take
// records, its pitch frames come back as the Worker finds them, for the
// live curve. Released, it asks the Worker to free the model and close,
// and terminates it if it does not within two seconds.

export type { LiveFrames } from '../engine/pitch/live'
export type { TrackerResult } from '../workers/tracker-protocol'

// A tracked recording's curve and features, as the score reads them.
export const recordingOfTracked = (
  tracked: Extract<TrackerResult, { _tag: 'Tracked' }>,
): Recording => recordingOfPayload(tracked)

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
  // The take's pitch frames as they are found, each from its first, to
  // any subscriber at any time: ends once the take's last frames are in,
  // when it fails, or when the tracker is released.
  frames: Stream.Stream<LiveFrames>
}>

// The part of a Worker the tracker uses, so tests can stand one in.
export type TrackerWorker = WorkerPort

export type TrackerAssets = Readonly<{ modelUrl: string; wasmPaths: string }>

// The frame messages kept for a subscriber that comes late: every one of
// a take of 80 s, one per 20 ms batch, past the longest take.
const framesReplay = 4096

export const openTrackerWorker = (
  makeWorker: () => TrackerWorker,
  assets: TrackerAssets,
): Effect.Effect<TrackerSession, TrackerError, Scope.Scope> =>
  Effect.gen(function* () {
    const liveFrames = yield* PubSub.unbounded<Take.Take<LiveFrames>>({
      replay: framesReplay,
    })
    const endFrames = (): void => {
      PubSub.endUnsafe(liveFrames, Exit.void)
    }
    const session = yield* openWorkerSession({
      name: 'The tracker',
      makeWorker,
      replies: FromTracker,
      transferables: (request: ToTracker) => transferables(request),
      load: {
        _tag: 'Load',
        modelUrl: assets.modelUrl,
        wasmPaths: assets.wasmPaths,
      },
      close: { _tag: 'Close' },
      fail: reason => new TrackerError({ reason }),
      // Frames go to the live curve as they come, never to the queue; any
      // reply but these and Loaded means no more frames are coming.
      route: reply => {
        if (reply._tag === 'Frames') {
          PubSub.publishUnsafe(liveFrames, [
            { firstFrame: reply.firstFrame, f0Hz: reply.f0Hz },
          ])
          return true
        }
        if (reply._tag === 'FramesEnded') {
          endFrames()
          return true
        }
        if (reply._tag !== 'Loaded') {
          endFrames()
        }
        return false
      },
      onStop: endFrames,
    })

    return {
      start: sampleRate => session.post({ _tag: 'Start', sampleRate }),
      push: samples => session.post({ _tag: 'Batch', samples }),
      finish: session
        .post({ _tag: 'Finish' })
        .pipe(
          Effect.andThen(
            session.reply<TrackerResult>(reply =>
              reply._tag === 'Tracked' ||
              reply._tag === 'TooQuiet' ||
              reply._tag === 'TooNoisy'
                ? reply
                : undefined,
            ),
          ),
        ),
      frames: Stream.fromPubSubTake(liveFrames),
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
  // samples, with no Worker and no model, and no live frames: its frames
  // end when the take finishes.
  static readonly layerTest = (
    respond: (samples: Float32Array, sampleRate: number) => TrackerResult,
  ): Layer.Layer<Tracker> =>
    Layer.succeed(
      Tracker,
      Tracker.of({
        open: Effect.gen(function* () {
          const parts: Array<Float32Array> = []
          let rate = 0
          const ended = yield* PubSub.unbounded<Take.Take<LiveFrames>>({
            replay: 1,
          })
          return {
            start: sampleRate =>
              Effect.sync(() => {
                rate = sampleRate
              }),
            push: batch =>
              Effect.sync(() => {
                parts.push(batch)
              }),
            frames: Stream.fromPubSubTake(ended),
            finish: Effect.sync(() => {
              PubSub.endUnsafe(ended, Exit.void)
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
