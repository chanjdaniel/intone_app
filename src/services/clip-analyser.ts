import {
  Context,
  Duration,
  Effect,
  Layer,
  Schema,
  type Scope,
  Stream,
} from 'effect'
import { modelUrls } from 'virtual:intone/models'
import { onnxRuntimeWasmPaths } from 'virtual:intone/onnx-runtime'

import type { LineQuality } from '../engine/cut/quality'
import type { Recording } from '../score/score'
import {
  type CutLine,
  FromClip,
  type ToClip,
  clipSampleRate,
  transferables,
} from '../workers/clip-protocol'
import { recordingOfPayload } from '../workers/recording-payload'
import { type WorkerPort, openWorkerSession } from './worker-session'

// An audio file the learner brings, made into a clip's lines: its length
// read first, from the file's own header where the browser can, so a clip
// over ten minutes is refused before it is decoded; then decoded, mixed
// to mono at 16 kHz, and handed to the clip Worker, which finds its
// speech with Silero VAD, cuts it into lines and tracks each line
// (../workers/clip.worker.ts). The whole is one Stream of steps, so
// whoever runs it shows its progress, and interrupting it cancels the
// cut at once: the Worker is asked to close, and terminated if it does
// not within two seconds, and the clip's audio goes with it. A kept clip
// is opened for the line editor the same way (`edit`): decoded once and
// held in the Worker, which gives its waveform and tracks the lines the
// learner changes, until its scope closes. Nothing here leaves the
// device.

// Ten minutes, as Daniel decided (report section 2): decoding stereo at
// 48 kHz holds about 230 MB.
export const longestClipSeconds = 600

export { clipSampleRate } from '../workers/clip-protocol'

export const ClipFailure = Schema.Literals([
  // The browser cannot play or decode the file.
  'Unsupported',
  // Over ten minutes.
  'TooLong',
  // Nothing in it sounded like speech.
  'NoSpeech',
  'Failed',
])
export type ClipFailure = typeof ClipFailure.Type

export class ClipAnalyserError extends Schema.TaggedError<
  ClipAnalyserError,
  { readonly brand: unique symbol }
>()('ClipAnalyserError', { failure: ClipFailure, reason: Schema.String }) {}

// A line of the clip: seconds from the clip's start, and its native
// curve and features with their quality, or why it has none.
export type AnalysedLine = Readonly<{
  from: number
  to: number
  native:
    | Readonly<{
        _tag: 'Tracked'
        recording: Recording
        quality: LineQuality
      }>
    | Readonly<{ _tag: 'TooQuiet' | 'TooNoisy' }>
}>

// A kept clip open in the line editor: its length, its waveform
// (../engine/audio/peaks.ts), and the lines at spans of it, in seconds,
// tracked as a cut tracks them.
export type ClipEditing = Readonly<{
  seconds: number
  peaks: Uint8Array
  track: (
    spans: ReadonlyArray<Readonly<{ from: number; to: number }>>,
  ) => Effect.Effect<ReadonlyArray<AnalysedLine>, ClipAnalyserError>
}>

export type ClipEvent =
  // Reading the file's length.
  | Readonly<{ _tag: 'Checking' }>
  | Readonly<{ _tag: 'Decoding' }>
  // `done` of `total` 32 ms windows searched for speech.
  | Readonly<{ _tag: 'FindingLines'; done: number; total: number }>
  // `done` of `total` lines tracked.
  | Readonly<{ _tag: 'TrackingLines'; done: number; total: number }>
  | Readonly<{
      _tag: 'Analysed'
      seconds: number
      lines: ReadonlyArray<AnalysedLine>
    }>

// The parts of the browser the analyser uses, so tests can stand them in.
export type ClipWorker = WorkerPort

export type ClipBrowser = Readonly<{
  // The file's length in seconds from its header, null when the browser
  // can play it but does not know its length before decoding it.
  probeSeconds: (file: Blob) => Effect.Effect<number | null, ClipAnalyserError>
  // The whole file decoded, mono at 16 kHz.
  decode: (file: Blob) => Effect.Effect<Float32Array, ClipAnalyserError>
  makeWorker: () => ClipWorker
  assets: Readonly<{
    speechModelUrl: string
    pitchModelUrl: string
    wasmPaths: string
  }>
}>

const failed = (failure: ClipFailure, reason: string) =>
  new ClipAnalyserError({ failure, reason })

// How long the browser may take to read a file's header.
const probeTimeout = Duration.seconds(20)

const tooLong = (seconds: number) =>
  failed(
    'TooLong',
    `It is ${minutesText(seconds)} long, and a clip can be at most ${longestClipSeconds / 60} minutes. Cut it shorter first.`,
  )

const minutesText = (seconds: number): string => {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const recordingOfLine = (curve: CutLine['curve']): AnalysedLine['native'] =>
  curve._tag === 'Tracked'
    ? {
        _tag: 'Tracked',
        quality: curve.quality,
        recording: recordingOfPayload(curve),
      }
    : curve

const analysedLineOf = (line: CutLine): AnalysedLine => ({
  from: line.from / clipSampleRate,
  to: line.to / clipSampleRate,
  native: recordingOfLine(line.curve),
})

// What the clip Worker does, once its models are loaded: cut a clip into
// lines, or hold one and track spans of it, one request at a time.
export type ClipWorkerSession = Readonly<{
  cut: (samples: Float32Array) => Stream.Stream<ClipEvent, ClipAnalyserError>
  hold: (samples: Float32Array) => Effect.Effect<Uint8Array, ClipAnalyserError>
  track: (
    spans: ReadonlyArray<Readonly<{ from: number; to: number }>>,
  ) => Effect.Effect<ReadonlyArray<AnalysedLine>, ClipAnalyserError>
}>

// The clip Worker with its models loaded, until the scope closes: then
// it is asked to stop and close, and terminated after the grace.
export const openClipWorker = (
  makeWorker: () => ClipWorker,
  assets: ClipBrowser['assets'],
): Effect.Effect<ClipWorkerSession, ClipAnalyserError, Scope.Scope> =>
  Effect.gen(function* () {
    const session = yield* openWorkerSession({
      name: 'The clip analyser',
      makeWorker,
      replies: FromClip,
      transferables: (request: ToClip) => transferables(request),
      load: { _tag: 'Load', ...assets },
      close: { _tag: 'Close' },
      fail: reason => failed('Failed', reason),
    })

    const hold = (samples: Float32Array) =>
      session
        .post({ _tag: 'Hold', samples })
        .pipe(
          Effect.andThen(
            session.reply(reply =>
              reply._tag === 'Held' ? reply.peaks : undefined,
            ),
          ),
        )

    const requests = { made: 0 }
    const track = (
      spans: ReadonlyArray<Readonly<{ from: number; to: number }>>,
    ) =>
      Effect.gen(function* () {
        requests.made += 1
        const request = requests.made
        yield* session.post({
          _tag: 'Track',
          request,
          spans: spans.map(span => ({
            from: Math.round(span.from * clipSampleRate),
            to: Math.round(span.to * clipSampleRate),
          })),
        })
        // An earlier request's answer, one the learner moved on from, is
        // passed over.
        const answer = (): Effect.Effect<
          ReadonlyArray<AnalysedLine>,
          ClipAnalyserError
        > =>
          session
            .reply<ReadonlyArray<AnalysedLine> | null>(reply =>
              reply._tag === 'TrackDone'
                ? reply.request === request
                  ? reply.lines.map(analysedLineOf)
                  : null
                : undefined,
            )
            .pipe(
              Effect.filterOrElse(
                (lines): lines is ReadonlyArray<AnalysedLine> => lines !== null,
                answer,
              ),
            )
        return yield* answer()
      })

    const cut = (samples: Float32Array) => {
      const seconds = samples.length / clipSampleRate
      return Stream.fromEffect(session.post({ _tag: 'Cut', samples })).pipe(
        Stream.flatMap(() => Stream.fromEffectRepeat(session.next)),
        Stream.takeUntil(
          reply => reply._tag === 'CutDone' || reply._tag === 'Failed',
        ),
        Stream.mapEffect(
          (reply): Effect.Effect<ClipEvent | null, ClipAnalyserError> => {
            if (reply._tag === 'Progress') {
              return Effect.succeed({
                _tag: reply.step,
                done: reply.done,
                total: reply.total,
              })
            }
            if (reply._tag === 'CutDone') {
              return reply.lines.length === 0
                ? Effect.fail(
                    failed(
                      'NoSpeech',
                      'Nothing in it sounded like speech, so it has no lines to copy.',
                    ),
                  )
                : Effect.succeed({
                    _tag: 'Analysed',
                    seconds,
                    lines: reply.lines.map(analysedLineOf),
                  })
            }
            if (reply._tag === 'Failed') {
              return Effect.fail(failed('Failed', reply.reason))
            }
            return Effect.succeed(null)
          },
        ),
        Stream.filter(event => event !== null),
      )
    }

    return { cut, hold, track }
  })

// `file`, checked, decoded and analysed, step by step, through `browser`.
export const analyseWith =
  (browser: ClipBrowser) =>
  (file: Blob): Stream.Stream<ClipEvent, ClipAnalyserError> =>
    Stream.concat(
      Stream.succeed<ClipEvent>({ _tag: 'Checking' }),
      Stream.unwrap(
        Effect.gen(function* () {
          const header = yield* browser.probeSeconds(file)
          if (header !== null && header > longestClipSeconds) {
            return yield* tooLong(header)
          }
          return Stream.concat(
            Stream.succeed<ClipEvent>({ _tag: 'Decoding' }),
            Stream.unwrap(
              Effect.gen(function* () {
                const samples = yield* browser.decode(file)
                const seconds = samples.length / clipSampleRate
                if (seconds > longestClipSeconds) {
                  return yield* tooLong(seconds)
                }
                const session = yield* openClipWorker(
                  browser.makeWorker,
                  browser.assets,
                )
                return session.cut(samples)
              }),
            ),
          )
        }),
      ),
    )

// A kept clip's `file` decoded and held in the clip Worker for the line
// editor, until the scope closes.
export const editWith =
  (browser: ClipBrowser) =>
  (file: Blob): Effect.Effect<ClipEditing, ClipAnalyserError, Scope.Scope> =>
    Effect.gen(function* () {
      const samples = yield* browser.decode(file)
      const seconds = samples.length / clipSampleRate
      const session = yield* openClipWorker(browser.makeWorker, browser.assets)
      const peaks = yield* session.hold(samples)
      return { seconds, peaks, track: session.track }
    })

// One clip Worker for many files, until the scope closes, as a local
// pack's import uses it (./local-pack.ts): each file decoded and held in
// turn, refused over ten minutes, and spans of it tracked as a cut tracks
// them; a file's `track` holds only until the next file is opened.
export const trackerWith = (
  browser: ClipBrowser,
): Effect.Effect<OpenFile, ClipAnalyserError, Scope.Scope> =>
  Effect.map(
    openClipWorker(browser.makeWorker, browser.assets),
    session => (file: Blob) =>
      Effect.gen(function* () {
        const samples = yield* browser.decode(file)
        const seconds = samples.length / clipSampleRate
        if (seconds > longestClipSeconds) {
          return yield* tooLong(seconds)
        }
        const peaks = yield* session.hold(samples)
        return { seconds, peaks, track: session.track }
      }),
  )

export type OpenFile = (
  file: Blob,
) => Effect.Effect<ClipEditing, ClipAnalyserError>

// The file's length from its header, by an audio element told to load
// only that: what the browser says when it cannot play the file is that
// it is not supported.
const probeWithMediaElement = (
  file: Blob,
): Effect.Effect<number | null, ClipAnalyserError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const url = yield* Effect.acquireRelease(
        Effect.sync(() => URL.createObjectURL(file)),
        made => Effect.sync(() => URL.revokeObjectURL(made)),
      )
      const element = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const audio = document.createElement('audio')
          audio.preload = 'metadata'
          return audio
        }),
        audio =>
          Effect.sync(() => {
            audio.removeAttribute('src')
            audio.load()
          }),
      )
      return yield* Effect.callback<number | null, ClipAnalyserError>(
        resume => {
          const loaded = (): void => {
            const seconds = element.duration
            resume(
              Effect.succeed(
                Number.isFinite(seconds) && seconds > 0 ? seconds : null,
              ),
            )
          }
          const refused = (): void => {
            resume(
              Effect.fail(
                failed(
                  'Unsupported',
                  'This browser cannot play it. Convert it to WAV, MP3 or M4A and try again.',
                ),
              ),
            )
          }
          element.addEventListener('loadedmetadata', loaded)
          element.addEventListener('error', refused)
          element.src = url
          return Effect.sync(() => {
            element.removeEventListener('loadedmetadata', loaded)
            element.removeEventListener('error', refused)
          })
        },
      ).pipe(
        Effect.timeoutOrElse({
          duration: probeTimeout,
          orElse: () =>
            Effect.fail(
              failed('Unsupported', 'This browser could not read its length.'),
            ),
        }),
      )
    }),
  )

// The whole file decoded by the browser at 16 kHz, its channels mixed.
const decodeWithAudioContext = (
  file: Blob,
): Effect.Effect<Float32Array, ClipAnalyserError> =>
  Effect.tryPromise({
    try: async () => {
      const context = new OfflineAudioContext(1, 1, clipSampleRate)
      const decoded = await context.decodeAudioData(await file.arrayBuffer())
      const mono = Float32Array.from(decoded.getChannelData(0))
      for (let channel = 1; channel < decoded.numberOfChannels; channel += 1) {
        const samples = decoded.getChannelData(channel)
        mono.forEach((sample, k) => {
          mono[k] = sample + (samples[k] ?? 0)
        })
      }
      if (decoded.numberOfChannels > 1) {
        mono.forEach((sample, k) => {
          mono[k] = sample / decoded.numberOfChannels
        })
      }
      return mono
    },
    catch: () =>
      failed(
        'Unsupported',
        'This browser cannot decode it. Convert it to WAV, MP3 or M4A and try again.',
      ),
  })

export class ClipAnalyser extends Context.Service<
  ClipAnalyser,
  {
    // `file`, step by step to its lines; interrupting the Stream cancels
    // it.
    readonly analyse: (
      file: Blob,
    ) => Stream.Stream<ClipEvent, ClipAnalyserError>
    // A kept clip's file, held for the line editor until the scope
    // closes.
    readonly edit: (
      file: Blob,
    ) => Effect.Effect<ClipEditing, ClipAnalyserError, Scope.Scope>
    // One Worker that opens file after file, until the scope closes.
    readonly tracker: Effect.Effect<OpenFile, ClipAnalyserError, Scope.Scope>
  }
>()('intone/services/ClipAnalyser') {
  // The browser's own audio element and decoder, and Silero VAD and
  // SwiftF0 in the clip Worker, from the app's own origin.
  static readonly layer = Layer.sync(ClipAnalyser, () => {
    const browser: ClipBrowser = {
      probeSeconds: probeWithMediaElement,
      decode: decodeWithAudioContext,
      makeWorker: () =>
        new Worker(new URL('../workers/clip.worker.ts', import.meta.url), {
          type: 'module',
          name: 'clip',
        }),
      assets: {
        speechModelUrl: modelUrls['silero-vad'],
        pitchModelUrl: modelUrls['swift-f0'],
        wasmPaths: onnxRuntimeWasmPaths,
      },
    }
    return ClipAnalyser.of({
      analyse: analyseWith(browser),
      edit: editWith(browser),
      tracker: trackerWith(browser),
    })
  })

  // Answers each file with the events `respond` gives it, and fails with
  // its error, with no browser, Worker or model; a clip opened to edit,
  // or by the tracker, is as `openEditing` gives it, or that error.
  static readonly layerTest = (
    respond: (file: Blob) => ReadonlyArray<ClipEvent> | ClipAnalyserError,
    openEditing: (file: Blob) => ClipEditing | ClipAnalyserError = () =>
      failed('Failed', 'This test opens no clip to edit.'),
  ): Layer.Layer<ClipAnalyser> => {
    const opened = (file: Blob) => {
      const answer = openEditing(file)
      return answer instanceof ClipAnalyserError
        ? Effect.fail(answer)
        : Effect.succeed(answer)
    }
    return Layer.succeed(
      ClipAnalyser,
      ClipAnalyser.of({
        analyse: file => {
          const answer = respond(file)
          return answer instanceof ClipAnalyserError
            ? Stream.fail(answer)
            : Stream.fromIterable(answer)
        },
        edit: file => opened(file),
        tracker: Effect.succeed(opened),
      }),
    )
  }
}
