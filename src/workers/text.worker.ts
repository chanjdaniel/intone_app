import { Effect, Exit, Fiber, Match, Schema, Scope, Stream } from 'effect'

import type { TextPiece } from '../engine/text/pieces'
import { type TextModelFetchError, ensureTextModel } from './text-model-cache'
import {
  type FromText,
  type TextModel,
  ToText,
  transferables,
} from './text-protocol'
import {
  type WhisperError,
  configureTransformers,
  openWhisper,
} from './whisper-session'
import { incoming, poster } from './worker-host'

// The text Worker: a clip's audio in, the pieces of its text out, each
// with its time. On `Download` it fetches the model's files into the
// device's cache (./text-model-cache.ts); on `Transcribe` it does that if
// they are not there yet, opens Whisper in a scope (./whisper-session.ts)
// and reads the clip window by window, posting its progress. A `Close`
// stops a download at once and a transcription at the next window, frees
// the model, says `Closed` and closes the Worker, so cancelling from the
// page frees its memory. Nothing here leaves the device: the only
// requests are for the model's files, on the app's own origin.

const post = poster<FromText>(transferables)

// Lets the Worker's event loop run, so a `Close` waiting in it is read.
const yieldToMessages = Effect.promise(
  () =>
    new Promise<void>(resolve => {
      setTimeout(resolve, 0)
    }),
)

// At most one progress message a tenth of a second while downloading.
const progressEveryMs = 100

const program = Effect.gen(function* () {
  const jobScope = yield* Scope.make()
  const state: {
    modelsRoot: string | null
    stopping: boolean
    job: Fiber.Fiber<void> | null
    // A job is interrupted at once, a download's fetch aborted, until
    // Whisper reads the clip: a run of it cannot be, so a transcription
    // stops at its next window from then on.
    interruptible: boolean
  } = { modelsRoot: null, stopping: false, job: null, interruptible: false }

  const download = (modelsRoot: string, model: TextModel) => {
    const sent = { at: 0 }
    return ensureTextModel(modelsRoot, model, (done, total) => {
      const now = performance.now()
      if (done === total || now - sent.at >= progressEveryMs) {
        sent.at = now
        self.postMessage({
          _tag: 'Progress',
          step: 'Downloading',
          done,
          total,
        } satisfies FromText)
      }
    })
  }

  const transcribe = (
    modelsRoot: string,
    model: TextModel,
    samples: Float32Array,
    windows: ReadonlyArray<Readonly<{ from: number; to: number }>>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* download(modelsRoot, model)
        yield* post({ _tag: 'Progress', step: 'Preparing', done: 0, total: 1 })
        const whisper = yield* openWhisper(model)
        // From here a run of Whisper cannot be interrupted, so a Close
        // waits for the next window.
        state.interruptible = false
        const pieces: Array<TextPiece> = []
        for (const [k, window] of windows.entries()) {
          yield* post({
            _tag: 'Progress',
            step: 'Transcribing',
            done: k,
            total: windows.length,
          })
          yield* yieldToMessages
          if (state.stopping) {
            return
          }
          pieces.push(...(yield* whisper.read(samples, window)))
        }
        yield* post({ _tag: 'Transcribed', device: whisper.device, pieces })
      }),
    )

  const run = (job: Effect.Effect<void, TextModelFetchError | WhisperError>) =>
    Effect.gen(function* () {
      if (state.job !== null) {
        return yield* post({
          _tag: 'Failed',
          reason: 'The text Worker is busy.',
        })
      }
      state.interruptible = true
      state.job = yield* Effect.forkIn(
        job.pipe(
          Effect.catch(error => post({ _tag: 'Failed', reason: error.reason })),
          Effect.ensuring(
            Effect.sync(() => {
              state.job = null
            }),
          ),
        ),
        jobScope,
      )
    })

  const loaded = (then: (modelsRoot: string) => Effect.Effect<void>) =>
    state.modelsRoot === null
      ? post({ _tag: 'Failed', reason: 'The text Worker is not loaded.' })
      : then(state.modelsRoot)

  const handle = (message: ToText): Effect.Effect<void> =>
    Match.value(message).pipe(
      Match.tagsExhaustive({
        Load: ({ modelsRoot, wasm, mjs }) =>
          Effect.gen(function* () {
            configureTransformers(modelsRoot, { wasm, mjs })
            state.modelsRoot = modelsRoot
            yield* post({ _tag: 'Loaded' })
          }),
        Download: ({ model }) =>
          loaded(modelsRoot =>
            run(
              download(modelsRoot, model).pipe(
                Effect.andThen(post({ _tag: 'Downloaded' })),
              ),
            ),
          ),
        Transcribe: ({ model, samples, windows }) =>
          loaded(modelsRoot =>
            run(transcribe(modelsRoot, model, samples, windows)),
          ),
        Close: () =>
          Effect.sync(() => {
            state.stopping = true
          }),
      }),
    )

  yield* incoming.pipe(
    Stream.mapEffect(data =>
      Schema.decodeUnknownEffect(ToText)(data).pipe(
        Effect.tap(handle),
        Effect.catchTag('SchemaError', error =>
          post({ _tag: 'Failed', reason: error.message }).pipe(Effect.as(null)),
        ),
      ),
    ),
    Stream.takeUntil(message => message?._tag === 'Close'),
    Stream.runDrain,
  )

  // A download stops at once; a transcription at its next window, before
  // the model it runs on is freed, or after a second, which the page's
  // two seconds of grace leave room for.
  if (state.job !== null) {
    const job = state.job
    yield* state.interruptible
      ? Fiber.interrupt(job)
      : Fiber.await(job).pipe(
          Effect.timeoutOrElse({
            duration: '1 second',
            orElse: () => Fiber.interrupt(job),
          }),
        )
  }
  yield* Scope.close(jobScope, Exit.void)
  yield* post({ _tag: 'Closed' })
  self.close()
})

Effect.runFork(Effect.scoped(program))
