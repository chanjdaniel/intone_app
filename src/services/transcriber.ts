import { Context, Effect, Layer, Match, Schema, Stream } from 'effect'
import { modelFiles, modelVersions, modelsRoot } from 'virtual:intone/models'
import { textRuntimeWasmPaths } from 'virtual:intone/onnx-runtime'

import { filesBytes } from '../engine/files'
import type { TextPiece } from '../engine/text/pieces'
import { type Span, textWindows } from '../engine/text/windows'
import { isTextModelKept } from '../workers/text-model-cache'
import {
  type Device,
  FromText,
  type TextModel,
  type ToText,
  textSampleRate,
  transferables,
} from '../workers/text-protocol'
import { type ClipAnalyserError, decodeWithAudioContext } from './clip-analyser'
import type { TextModelId } from './history-records'
import { type WorkerPort, openWorkerSession } from './worker-session'

// The text of a clip the learner brought, written out on the device by
// Whisper in the text Worker (../workers/text.worker.ts), only once the
// learner has agreed to its download: the file decoded at 16 kHz, cut
// into the windows Whisper reads (../engine/text/windows.ts) and read in
// the background, as one Stream of steps, so whoever runs it shows its
// progress, and interrupting it cancels it: the Worker is asked to close,
// and terminated if it does not within two seconds. The text is display
// only: no score reads it. Nothing here leaves the device; the only
// requests are for the model's own files, on the app's own origin.

// The model as Transformers.js loads it, one of the two the learner may
// choose, as Daniel decided (report section 2): whisper-base, and
// whisper-small for better text, from the build's model list.
export const textModelOf = (id: TextModelId): TextModel => ({
  name: `${id}/${modelVersions[id]}`,
  files: modelFiles[id],
})

// What the download takes, in bytes: every file Transformers.js loads.
export const textModelBytes = (id: TextModelId): number =>
  filesBytes(modelFiles[id])

export const textModelVersion = (id: TextModelId): string => modelVersions[id]

export class TranscriberError extends Schema.TaggedError<
  TranscriberError,
  { readonly brand: unique symbol }
>()('TranscriberError', { reason: Schema.String }) {}

export type TextEvent =
  | Readonly<{ _tag: 'Decoding' }>
  // Bytes of the model on the device, of all it takes.
  | Readonly<{ _tag: 'Downloading'; done: number; total: number }>
  | Readonly<{ _tag: 'Preparing' }>
  // Windows of the clip read, of all of them.
  | Readonly<{ _tag: 'Transcribing'; done: number; total: number }>

export type TextDone =
  | Readonly<{ _tag: 'Downloaded' }>
  | Readonly<{
      _tag: 'Transcribed'
      device: Device
      pieces: ReadonlyArray<TextPiece>
    }>

// The parts of the browser the transcriber uses, so tests can stand them in.
export type TextBrowser = Readonly<{
  decode: (file: Blob) => Effect.Effect<Float32Array, ClipAnalyserError>
  makeWorker: () => WorkerPort
  assets: Readonly<{ modelsRoot: string; wasm: string; mjs: string }>
}>

const failed = (reason: string) => new TranscriberError({ reason })

const session = (browser: TextBrowser) =>
  openWorkerSession({
    name: 'The text model',
    makeWorker: browser.makeWorker,
    replies: FromText,
    transferables: (request: ToText) => transferables(request),
    load: { _tag: 'Load', ...browser.assets },
    close: { _tag: 'Close' },
    fail: failed,
  })

// The Worker's replies to one request, as steps, until it is done.
const repliesOf = (
  next: Effect.Effect<FromText | Readonly<{ _tag: 'Failed'; reason: string }>>,
): Stream.Stream<TextEvent | TextDone, TranscriberError> =>
  Stream.fromEffectRepeat(next).pipe(
    Stream.takeUntil(
      reply =>
        reply._tag === 'Downloaded' ||
        reply._tag === 'Transcribed' ||
        reply._tag === 'Failed',
    ),
    Stream.mapEffect(
      (reply): Effect.Effect<TextEvent | TextDone | null, TranscriberError> =>
        Match.value(reply).pipe(
          Match.tagsExhaustive({
            Progress: ({ step, done, total }) =>
              Effect.succeed<TextEvent>(
                step === 'Preparing'
                  ? { _tag: 'Preparing' }
                  : { _tag: step, done, total },
              ),
            Downloaded: () => Effect.succeed<TextDone>({ _tag: 'Downloaded' }),
            Transcribed: ({ device, pieces }) =>
              Effect.succeed<TextDone>({ _tag: 'Transcribed', device, pieces }),
            Failed: ({ reason }) => Effect.fail(failed(reason)),
            Loaded: () => Effect.succeed(null),
            Closed: () => Effect.succeed(null),
          }),
        ),
    ),
    Stream.filter(event => event !== null),
  )

// The model's files fetched onto the device, step by step.
export const downloadWith =
  (browser: TextBrowser) =>
  (id: TextModelId): Stream.Stream<TextEvent | TextDone, TranscriberError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const worker = yield* session(browser)
        yield* worker.post({ _tag: 'Download', model: textModelOf(id) })
        return repliesOf(worker.next)
      }),
    )

// `file`, a clip whose lines are at `lines` (seconds), decoded and read
// by the model, step by step.
export const transcribeWith =
  (browser: TextBrowser) =>
  (
    id: TextModelId,
    file: Blob,
    lines: ReadonlyArray<Span>,
  ): Stream.Stream<TextEvent | TextDone, TranscriberError> =>
    Stream.concat(
      Stream.succeed<TextEvent>({ _tag: 'Decoding' }),
      Stream.unwrap(
        Effect.gen(function* () {
          const samples = yield* browser
            .decode(file)
            .pipe(Effect.mapError(error => failed(error.reason)))
          const windows = textWindows(lines, samples.length / textSampleRate)
          const worker = yield* session(browser)
          yield* worker.post({
            _tag: 'Transcribe',
            model: textModelOf(id),
            samples,
            windows,
          })
          return repliesOf(worker.next)
        }),
      ),
    )

export class Transcriber extends Context.Service<
  Transcriber,
  {
    // The model's files fetched onto the device; interrupting the Stream
    // cancels it.
    readonly download: (
      id: TextModelId,
    ) => Stream.Stream<TextEvent | TextDone, TranscriberError>
    // A clip's text, piece by piece with its time; interrupting the
    // Stream cancels it.
    readonly transcribe: (
      id: TextModelId,
      file: Blob,
      lines: ReadonlyArray<Span>,
    ) => Stream.Stream<TextEvent | TextDone, TranscriberError>
    // Whether every file of the model is already on this device, so a
    // job with it downloads nothing.
    readonly isKept: (id: TextModelId) => Effect.Effect<boolean>
  }
>()('intone/services/Transcriber') {
  // The browser's decoder and Whisper in the text Worker, from the app's
  // own origin.
  static readonly layer = Layer.sync(Transcriber, () => {
    const browser: TextBrowser = {
      decode: decodeWithAudioContext,
      makeWorker: () =>
        new Worker(new URL('../workers/text.worker.ts', import.meta.url), {
          type: 'module',
          name: 'text',
        }),
      assets: { modelsRoot, ...textRuntimeWasmPaths },
    }
    return Transcriber.of({
      download: downloadWith(browser),
      transcribe: transcribeWith(browser),
      isKept: id => isTextModelKept(modelsRoot, textModelOf(id)),
    })
  })

  // Answers each request with the events `respond` gives it, and fails
  // with its error, with no browser, Worker or model; a model is on the
  // device when `kept` says so.
  static readonly layerTest = (
    respond: (
      request:
        | Readonly<{ _tag: 'Download'; id: TextModelId }>
        | Readonly<{
            _tag: 'Transcribe'
            id: TextModelId
            file: Blob
            lines: ReadonlyArray<Span>
          }>,
    ) => ReadonlyArray<TextEvent | TextDone> | TranscriberError,
    kept: (id: TextModelId) => boolean = () => true,
  ): Layer.Layer<Transcriber> => {
    const answered = (answer: ReturnType<typeof respond>) =>
      answer instanceof TranscriberError
        ? Stream.fail(answer)
        : Stream.fromIterable(answer)
    return Layer.succeed(
      Transcriber,
      Transcriber.of({
        download: id => answered(respond({ _tag: 'Download', id })),
        transcribe: (id, file, lines) =>
          answered(respond({ _tag: 'Transcribe', id, file, lines })),
        isKept: id => Effect.succeed(kept(id)),
      }),
    )
  }
}
