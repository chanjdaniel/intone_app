import { Effect, Exit, Fiber, Match, Schema, Scope, Stream } from 'effect'

import { waveformPeaks } from '../engine/audio/peaks'
import {
  type ClipLine,
  type ClipProgress,
  analyseClip,
  trackSpans,
} from '../engine/cut/clip'
import type { SileroInference } from '../engine/cut/silero'
import type { SwiftF0Inference } from '../engine/pitch/swift-f0'
import { reasonOf } from '../engine/reason'
import {
  type CutLine,
  type FromClip,
  ToClip,
  transferables,
} from './clip-protocol'
import { fetchModel } from './onnx-session'
import { payloadOf } from './recording-payload'
import { openSilero } from './silero-session'
import { openSwiftF0 } from './swift-f0-session'
import { incoming, poster } from './worker-host'

// The clip Worker: a whole clip's audio in, its lines and each line's
// native curve out. It loads Silero VAD and SwiftF0 inside a scope on
// `Load`; on `Cut` it finds the speech, cuts it into lines and tracks
// each line (../engine/cut/clip.ts), posting its progress as it goes. A
// `Close` stops a cut at the next window or line, frees both models,
// says `Closed` and closes the Worker, so cancelling from the page frees
// the clip's memory. For the line editor it holds a kept clip instead
// (`Hold`, answered with its waveform) and tracks the lines the learner
// changed (`Track`), one request at a time.

const post = poster<FromClip>(transferables)

class CutError extends Schema.TaggedError<
  CutError,
  { readonly brand: unique symbol }
>()('CutError', { reason: Schema.String }) {}

// What the engine throws from its progress callback once the page has
// asked to stop: it ends the cut between two model runs.
class Stopped extends Error {}

// Lets the Worker's event loop run, so a `Close` waiting in it is read.
const yieldToMessages = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0)
  })

type Models = { speech: SileroInference; pitch: SwiftF0Inference }

const cutLineOf = (line: ClipLine): CutLine =>
  line.curve._tag === 'Tracked'
    ? {
        from: line.from,
        to: line.to,
        curve: {
          _tag: 'Tracked',
          ...payloadOf(line.curve.curve, {
            dims: line.curve.featureDims,
            data: line.curve.features,
          }),
          quality: line.curve.quality,
        },
      }
    : { from: line.from, to: line.to, curve: line.curve }

const program = Effect.gen(function* () {
  const modelScope = yield* Scope.make()
  const cutScope = yield* Scope.make()
  const state: {
    models: Models | null
    stopping: boolean
    cutting: Fiber.Fiber<void> | null
    held: Float32Array | null
  } = { models: null, stopping: false, cutting: null, held: null }

  const load = (message: Extract<ToClip, { _tag: 'Load' }>) =>
    Effect.gen(function* () {
      const [speechModel, pitchModel] = yield* Effect.all([
        fetchModel(message.speechModelUrl, 'speech model'),
        fetchModel(message.pitchModelUrl, 'pitch model'),
      ])
      const speech = yield* openSilero(speechModel, message.wasmPaths).pipe(
        Scope.provide(modelScope),
      )
      const pitch = yield* openSwiftF0(pitchModel, message.wasmPaths).pipe(
        Scope.provide(modelScope),
      )
      const runPromise = Effect.runPromiseWith(yield* Effect.context())
      state.models = {
        speech: (input, last) => runPromise(speech(input, last)),
        pitch: (samples, minHz, maxHz) =>
          runPromise(pitch(samples, minHz, maxHz)),
      }
      yield* post({ _tag: 'Loaded' })
    })

  const progress = async (step: ClipProgress): Promise<void> => {
    const message: FromClip = {
      _tag: 'Progress',
      step: step._tag,
      done: step.done,
      total: step.total,
    }
    self.postMessage(message)
    await yieldToMessages()
    if (state.stopping) {
      throw new Stopped()
    }
  }

  const cut = (samples: Float32Array, models: Models) =>
    Effect.tryPromise({
      try: () => analyseClip(samples, models, progress),
      catch: error =>
        error instanceof Stopped
          ? null
          : new CutError({ reason: reasonOf(error) }),
    }).pipe(
      Effect.flatMap(lines =>
        post({ _tag: 'CutDone', lines: lines.map(cutLineOf) }),
      ),
      Effect.catch(error =>
        error === null
          ? Effect.void
          : post({ _tag: 'Failed', reason: error.reason }),
      ),
    )

  const track = (
    request: number,
    samples: Float32Array,
    spans: ReadonlyArray<Readonly<{ from: number; to: number }>>,
    models: Models,
  ) =>
    Effect.tryPromise({
      try: () =>
        trackSpans(samples, spans, models, async () => {
          await yieldToMessages()
          if (state.stopping) {
            throw new Stopped()
          }
        }),
      catch: error =>
        error instanceof Stopped
          ? null
          : new CutError({ reason: reasonOf(error) }),
    }).pipe(
      Effect.flatMap(lines =>
        post({ _tag: 'TrackDone', request, lines: lines.map(cutLineOf) }),
      ),
      Effect.catch(error =>
        error === null
          ? Effect.void
          : post({ _tag: 'Failed', reason: error.reason }),
      ),
    )

  const busy = (models: Models | null): string | null =>
    models === null
      ? 'The models are not loaded.'
      : state.cutting !== null
        ? 'The clip analyser is busy.'
        : null

  const handle = (message: ToClip): Effect.Effect<void> =>
    Match.value(message).pipe(
      Match.tagsExhaustive({
        Load: message =>
          load(message).pipe(
            Effect.catch(error =>
              post({ _tag: 'Failed', reason: error.reason }),
            ),
          ),
        Cut: ({ samples }) =>
          Effect.gen(function* () {
            const { models } = state
            const reason = busy(models)
            if (models === null || reason !== null) {
              return yield* post({ _tag: 'Failed', reason: reason ?? '' })
            }
            state.cutting = yield* Effect.forkIn(cut(samples, models), cutScope)
          }),
        Hold: ({ samples }) =>
          Effect.gen(function* () {
            state.held = samples
            yield* post({
              _tag: 'Held',
              peaks: waveformPeaks(samples, 16_000),
            })
          }),
        Track: ({ request, spans }) =>
          Effect.gen(function* () {
            const { models, held } = state
            const reason =
              busy(models) ?? (held === null ? 'No clip is held.' : null)
            if (models === null || held === null || reason !== null) {
              return yield* post({ _tag: 'Failed', reason: reason ?? '' })
            }
            state.cutting = yield* Effect.forkIn(
              track(request, held, spans, models).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    state.cutting = null
                  }),
                ),
              ),
              cutScope,
            )
          }),
        Close: () =>
          Effect.sync(() => {
            state.stopping = true
          }),
      }),
    )

  yield* incoming.pipe(
    Stream.mapEffect(data =>
      Schema.decodeUnknownEffect(ToClip)(data).pipe(
        Effect.tap(handle),
        Effect.catchTag('SchemaError', error =>
          post({ _tag: 'Failed', reason: error.message }).pipe(Effect.as(null)),
        ),
      ),
    ),
    Stream.takeUntil(message => message?._tag === 'Close'),
    Stream.runDrain,
  )

  // A cut under way stops at its next window or line, before the models
  // it runs on are freed.
  if (state.cutting !== null) {
    yield* Fiber.await(state.cutting)
  }
  yield* Scope.close(cutScope, Exit.void)
  yield* Scope.close(modelScope, Exit.void)
  yield* post({ _tag: 'Closed' })
  self.close()
})

Effect.runFork(Effect.scoped(program))
