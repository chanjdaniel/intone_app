import { Clock, Effect, Layer, Option, Schema, Stream } from 'effect'
import { File, Subscription } from 'foldkit'

import { ClipAnalyser, type ClipEvent } from '../../services/clip-analyser'
import { HistoryStore } from '../../services/history-store'
import { Message } from '../message'
import type { Model } from '../model'
import { UploadStep } from './upload'

// While a clip is being cut: the file goes through the clip analyser
// (../../services/clip-analyser.ts), each step comes to the Model as it
// happens, and the clip with its lines and their curves goes to the
// device, never into the Model. The Model hears the clip's id once it is
// kept. Leaving the Working state (a cancel, leaving the screen) ends the
// Stream, which stops the clip Worker and frees the clip's audio; a clip
// already being kept is kept whole first.

const stepOf = (event: Exclude<ClipEvent, { _tag: 'Analysed' }>): UploadStep =>
  event._tag === 'Checking'
    ? UploadStep.Checking()
    : event._tag === 'Decoding'
      ? UploadStep.Decoding()
      : event._tag === 'FindingLines'
        ? UploadStep.FindingLines({ done: event.done, total: event.total })
        : UploadStep.TrackingLines({ done: event.done, total: event.total })

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Keeps the cut clip on the device: its file, read once more, and its
// lines. It runs to its end once begun, so a cancel never leaves a file
// without its record.
const keep = (
  jobNumber: number,
  file: File.File,
  analysed: Extract<ClipEvent, { _tag: 'Analysed' }>,
) =>
  Effect.gen(function* () {
    const history = yield* HistoryStore
    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await file.arrayBuffer()),
      catch: error => ({
        reason: `The file could not be read again: ${reasonOf(error)}`,
      }),
    })
    const addedAt = yield* Clock.currentTimeMillis
    const clip = yield* history.addClip({
      name: File.name(file),
      type: File.mimeType(file),
      addedAt,
      seconds: analysed.seconds,
      bytes,
      lines: analysed.lines,
    })
    return Message.SucceededUpload({ jobNumber, clipId: clip.id })
  }).pipe(Effect.uninterruptible)

export const uploadEvents = (
  jobNumber: number,
  file: File.File,
): Stream.Stream<Message, never, ClipAnalyser | HistoryStore> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const analyser = yield* ClipAnalyser
      return analyser.analyse(file).pipe(
        Stream.mapEffect(event =>
          event._tag === 'Analysed'
            ? Effect.succeed([
                Message.ProgressedUpload({
                  jobNumber,
                  step: UploadStep.Keeping(),
                }),
              ] as const).pipe(
                Effect.zip(keep(jobNumber, file, event)),
                Effect.map(([progress, kept]) => [...progress, kept]),
              )
            : Effect.succeed([
                Message.ProgressedUpload({ jobNumber, step: stepOf(event) }),
              ]),
        ),
        Stream.flatMap(messages => Stream.fromIterable(messages)),
        Stream.catch(error =>
          Stream.succeed(
            Message.FailedUpload({ jobNumber, reason: error.reason }),
          ),
        ),
      )
    }),
  )

const Job = Schema.Struct({
  jobNumber: Schema.Finite,
  file: Schema.instanceOf(globalThis.File),
})

export const uploadJobOf = (model: Model) =>
  model.upload.job._tag === 'Working'
    ? Option.some({
        jobNumber: model.upload.job.jobNumber,
        file: model.upload.job.file,
      })
    : Option.none()

export const uploadSubscriptions = Subscription.make<Model, Message>()(
  entry => ({
    upload: entry(
      { maybeJob: Schema.Option(Job) },
      {
        modelToDependencies: model => ({ maybeJob: uploadJobOf(model) }),
        dependenciesToStream: ({ maybeJob }) =>
          Option.match(maybeJob, {
            onNone: () => Stream.empty,
            onSome: ({ jobNumber, file }) =>
              uploadEvents(jobNumber, file).pipe(
                Stream.provide(
                  Layer.merge(ClipAnalyser.layer, HistoryStore.layer),
                ),
              ),
          }),
      },
    ),
  }),
)
