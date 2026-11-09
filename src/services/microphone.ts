import {
  type Cause,
  Context,
  Deferred,
  Effect,
  Layer,
  Queue,
  Schema,
  type Scope,
  Stream,
} from 'effect'

import { audioBufferOf, playBuffer } from '../engine/audio/buffer-source'
import type { Wav } from '../engine/audio/wav'
import { createCaptureNode } from '../engine/worklet/capture'

// The microphone during a take: an AudioContext, the capture worklet and,
// once the worklet runs, the microphone connected to it, all released
// together when the scope that opened them closes. The ManagedResource
// that owns it closes that scope on every path out of a take.

// What the browser gave for the constraints asked of it, read back from
// the track: they are best effort, so the app logs what it got.
export const MicrophoneSettings = Schema.Struct({
  echoCancellation: Schema.optional(Schema.Boolean),
  noiseSuppression: Schema.optional(Schema.Boolean),
  autoGainControl: Schema.optional(Schema.Boolean),
  sampleRate: Schema.optional(Schema.Finite),
  channelCount: Schema.optional(Schema.Finite),
  deviceId: Schema.optional(Schema.String),
})
export type MicrophoneSettings = typeof MicrophoneSettings.Type

export type MicrophoneSession = Readonly<{
  // The AudioContext's rate, which every batch is at.
  sampleRate: number
  settings: MicrophoneSettings
  // Every 20 ms of the microphone's samples, mono, from the moment it is
  // connected, in order; it ends when the session is released.
  batches: Stream.Stream<Float32Array>
}>

// Denied: the learner or the browser refused the microphone. NoDevice:
// there is none to open. Failed: anything else, named in `message`.
export const MicrophoneFailure = Schema.Literals([
  'Denied',
  'NoDevice',
  'Failed',
])
export type MicrophoneFailure = typeof MicrophoneFailure.Type

export class MicrophoneError extends Schema.TaggedError<
  MicrophoneError,
  { readonly brand: unique symbol }
>()('MicrophoneError', {
  failure: MicrophoneFailure,
  message: Schema.String,
}) {}

// Echo cancellation, noise suppression and automatic gain all off, so the
// curve follows the learner's own voice (docs/fake-microphone.md measures
// what each does to it).
export const audioConstraints: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Sorts what `getUserMedia` threw into what the learner is told.
export const microphoneErrorOf = (error: unknown): MicrophoneError => {
  const name = error instanceof DOMException ? error.name : ''
  const failure: MicrophoneFailure =
    name === 'NotAllowedError' || name === 'SecurityError'
      ? 'Denied'
      : name === 'NotFoundError' || name === 'OverconstrainedError'
        ? 'NoDevice'
        : 'Failed'
  return new MicrophoneError({ failure, message: messageOf(error) })
}

const failedWith = (error: unknown): MicrophoneError =>
  new MicrophoneError({ failure: 'Failed', message: messageOf(error) })

// Asks for the microphone. The prompt may never be answered, so this can
// be interrupted while it waits; a stream granted after that is stopped
// at once rather than left open.
const requestMicrophone: Effect.Effect<MediaStream, MicrophoneError> =
  Effect.callback<MediaStream, MicrophoneError>(resume => {
    let abandoned = false
    const mediaDevices = globalThis.navigator?.mediaDevices
    if (mediaDevices === undefined) {
      resume(
        Effect.fail(
          new MicrophoneError({
            failure: 'Failed',
            message: 'This page cannot use a microphone: it needs HTTPS.',
          }),
        ),
      )
      return
    }
    mediaDevices.getUserMedia({ audio: audioConstraints }).then(
      stream => {
        if (abandoned) {
          stream.getTracks().forEach(track => track.stop())
        } else {
          resume(Effect.succeed(stream))
        }
      },
      error => {
        resume(Effect.fail(microphoneErrorOf(error)))
      },
    )
    return Effect.sync(() => {
      abandoned = true
    })
  })

const stopTracks = (stream: MediaStream): Effect.Effect<void> =>
  Effect.sync(() => {
    stream.getTracks().forEach(track => track.stop())
  })

// Connects a source to the running capture node and says what it is.
type Connect = (
  context: AudioContext,
  node: AudioWorkletNode,
) => Effect.Effect<MicrophoneSettings, MicrophoneError, Scope.Scope>

const openCapture = (
  connect: Connect,
  contextOptions: AudioContextOptions,
): Effect.Effect<MicrophoneSession, MicrophoneError, Scope.Scope> =>
  Effect.gen(function* () {
    const context = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new AudioContext(contextOptions),
        catch: failedWith,
      }),
      opened => Effect.promise(() => opened.close()).pipe(Effect.ignore),
    )
    const batches = yield* Queue.unbounded<Float32Array, Cause.Done>()
    yield* Effect.addFinalizer(() => Queue.end(batches))
    const running = yield* Deferred.make<void>()
    let connected = false
    const node = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          createCaptureNode(context, batch => {
            Deferred.doneUnsafe(running, Effect.void)
            if (connected) {
              Queue.offerUnsafe(batches, batch)
            }
          }),
        catch: failedWith,
      }),
      created =>
        Effect.sync(() => {
          created.port.onmessage = null
          created.disconnect()
        }),
    )
    yield* Effect.tryPromise({ try: () => context.resume(), catch: failedWith })
    // The fake microphone, and some real ones, play from the moment the
    // stream opens: the worklet must already be running, or the start of
    // the take is lost (docs/fake-microphone.md).
    yield* Deferred.await(running)
    const settings = yield* connect(context, node)
    connected = true
    yield* Effect.log('Microphone opened', {
      sampleRate: context.sampleRate,
      ...settings,
    })
    return {
      sampleRate: context.sampleRate,
      settings,
      batches: Stream.fromQueue(batches),
    }
  })

const connectMicrophone: Connect = (context, node) =>
  Effect.gen(function* () {
    const stream = yield* Effect.acquireRelease(requestMicrophone, stopTracks, {
      interruptible: true,
    })
    const source = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const created = context.createMediaStreamSource(stream)
          created.connect(node)
          return created
        },
        catch: failedWith,
      }),
      created => Effect.sync(() => created.disconnect()),
    )
    const [track] = source.mediaStream.getAudioTracks()
    if (track === undefined) {
      return yield* new MicrophoneError({
        failure: 'NoDevice',
        message: 'The microphone gave no audio track.',
      })
    }
    return yield* Schema.decodeUnknownEffect(MicrophoneSettings)(
      track.getSettings(),
    ).pipe(Effect.orElseSucceed(() => ({})))
  })

const connectBuffer =
  (wav: Wav): Connect =>
  (_context, node) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => playBuffer(audioBufferOf(wav), node)),
        playback => Effect.sync(() => playback.stop()),
      )
      return {}
    })

export class Microphone extends Context.Service<
  Microphone,
  {
    // Opens the microphone for one take, until the scope closes.
    readonly open: Effect.Effect<
      MicrophoneSession,
      MicrophoneError,
      Scope.Scope
    >
  }
>()('intone/services/Microphone') {
  // The learner's microphone, through getUserMedia.
  static readonly layer = Layer.succeed(
    Microphone,
    Microphone.of({
      open: openCapture(connectMicrophone, { latencyHint: 'interactive' }),
    }),
  )

  // A decoded recording played into the same capture worklet in place of
  // the microphone, sample for sample (src/engine/audio/buffer-source.ts):
  // the AudioContext runs at the recording's own rate.
  static readonly layerBuffer = (wav: Wav): Layer.Layer<Microphone> =>
    Layer.succeed(
      Microphone,
      Microphone.of({
        open: openCapture(connectBuffer(wav), { sampleRate: wav.sampleRate }),
      }),
    )
}
