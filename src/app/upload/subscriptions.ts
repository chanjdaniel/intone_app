import { Clock, Effect, Fiber, Layer, Option, Schema, Stream } from 'effect'
import { File, Subscription } from 'foldkit'

import { reasonOf } from '../../engine/reason'
import { ClipAnalyser, type ClipEvent } from '../../services/clip-analyser'
import { HistoryStore } from '../../services/history-store'
import { type PackEvent, importPack } from '../../services/local-pack'
import { Message } from '../message'
import type { Model } from '../model'
import { PackStep, UploadStep } from './upload'

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

// The write starts first, then the Model hears Keeping, which refuses a
// Stop, then the clip's id. Started, the write runs to its end, and the
// Stream does not end before it does, even when it is ended early.
const keeping = (
  jobNumber: number,
  file: File.File,
  analysed: Extract<ClipEvent, { _tag: 'Analysed' }>,
) =>
  Stream.unwrap(
    Effect.acquireRelease(
      Effect.forkDetach(keep(jobNumber, file, analysed), {
        uninterruptible: true,
      }),
      Fiber.await,
    ).pipe(
      Effect.map(fiber =>
        Stream.concat(
          Stream.make(
            Message.ProgressedUpload({ jobNumber, step: UploadStep.Keeping() }),
          ),
          Stream.fromEffect(Fiber.join(fiber)),
        ),
      ),
    ),
  )

export const uploadEvents = (
  jobNumber: number,
  file: File.File,
): Stream.Stream<Message, never, ClipAnalyser | HistoryStore> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const analyser = yield* ClipAnalyser
      return analyser.analyse(file).pipe(
        Stream.flatMap(event =>
          event._tag === 'Analysed'
            ? keeping(jobNumber, file, event)
            : Stream.make(
                Message.ProgressedUpload({ jobNumber, step: stepOf(event) }),
              ),
        ),
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

const packStepOf = (
  event: Exclude<PackEvent, { _tag: 'Imported' }>,
): PackStep =>
  event._tag === 'Reading'
    ? PackStep.Reading()
    : event._tag === 'Keeping'
      ? PackStep.Keeping()
      : event._tag === 'CheckingFiles'
        ? PackStep.CheckingFiles({ done: event.done, total: event.total })
        : PackStep.TrackingLines({ done: event.done, total: event.total })

// A local pack's import (../../services/local-pack.ts): each step comes
// to the Model, the pack's lines and curves go to the device, and the
// Model hears the level's id.
export const packEvents = (
  jobNumber: number,
  files: ReadonlyArray<File.File>,
): Stream.Stream<Message, never, ClipAnalyser | HistoryStore> =>
  importPack(
    files.map(file => ({
      path:
        file.webkitRelativePath === '' ? file.name : file.webkitRelativePath,
      file,
    })),
  ).pipe(
    Stream.map(event =>
      event._tag === 'Imported'
        ? Message.SucceededPackImport({ jobNumber, clipId: event.clipId })
        : Message.ProgressedPackImport({ jobNumber, step: packStepOf(event) }),
    ),
    Stream.catch(error =>
      Stream.succeed(
        Message.FailedPackImport({ jobNumber, reason: error.reason }),
      ),
    ),
  )

const PackJobFiles = Schema.Struct({
  jobNumber: Schema.Finite,
  files: Schema.Array(Schema.instanceOf(globalThis.File)),
})

export const packJobOf = (model: Model) =>
  model.upload.packJob._tag === 'Working'
    ? Option.some({
        jobNumber: model.upload.packJob.jobNumber,
        files: model.upload.packJob.files,
      })
    : Option.none()

export const uploadSubscriptions = Subscription.make<Model, Message>()(
  entry => ({
    pack: entry(
      { maybeJob: Schema.Option(PackJobFiles) },
      {
        modelToDependencies: model => ({ maybeJob: packJobOf(model) }),
        dependenciesToStream: ({ maybeJob }) =>
          Option.match(maybeJob, {
            onNone: () => Stream.empty,
            onSome: ({ jobNumber, files }) =>
              packEvents(jobNumber, files).pipe(
                Stream.provide(
                  Layer.merge(ClipAnalyser.layer, HistoryStore.layer),
                ),
              ),
          }),
      },
    ),
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
