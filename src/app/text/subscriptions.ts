import {
  Clock,
  Effect,
  Fiber,
  Layer,
  Match,
  Option,
  Schema,
  Stream,
} from 'effect'
import { Subscription } from 'foldkit'

import { ClipStore } from '../../services/clip-store'
import { TextModelId } from '../../services/history-records'
import { HistoryStore } from '../../services/history-store'
import {
  type TextDone,
  type TextEvent,
  Transcriber,
  TranscriberError,
  textModelVersion,
} from '../../services/transcriber'
import { levelClipOf } from '../level/level'
import { Message } from '../message'
import type { Model } from '../model'
import { TextPurpose, TextStep } from './text'

// The one text job, while the Model's `textJob` is Working, whatever
// screen is open, so practice never waits for it: the model's download,
// or a clip's text, read from the clip's file on the device by the
// transcriber (../../services/transcriber.ts). Each step comes to the
// Model as it happens; the text's pieces go to the device, never into
// the Model, which hears the clip as it then is. Leaving the Working
// state (Stop) ends the Stream, which stops the text Worker and frees
// the model; a transcript already being kept is kept whole first.

const stepOf = (event: TextEvent): TextStep =>
  Match.valueTags(event, {
    Decoding: () => TextStep.Decoding(),
    Downloading: ({ done, total }) => TextStep.Downloading({ done, total }),
    Preparing: () => TextStep.Preparing(),
    Transcribing: ({ done, total }) => TextStep.Transcribing({ done, total }),
  })

const failed = (reason: string) => new TranscriberError({ reason })

// The clip's file and lines, as the device keeps them.
const clipToRead = (clipId: string) =>
  Effect.gen(function* () {
    const history = yield* HistoryStore
    const files = yield* ClipStore
    const maybeClip = yield* history.clip(clipId)
    if (Option.isNone(maybeClip) || maybeClip.value.audio === null) {
      return yield* failed(
        'The clip, or its audio, is no longer on this device.',
      )
    }
    const clip = maybeClip.value
    const audio = maybeClip.value.audio
    const maybeBytes = yield* files.read(audio.file)
    if (Option.isNone(maybeBytes)) {
      return yield* failed('The clip’s audio is no longer on this device.')
    }
    return {
      clip,
      file: new Blob([Uint8Array.from(maybeBytes.value)], { type: audio.type }),
    }
  }).pipe(
    Effect.mapError(error =>
      error instanceof TranscriberError ? error : failed(error.reason),
    ),
  )

// Keeps the transcript; once begun it runs to its end, so a Stop never
// leaves half of it.
const keep = (
  jobNumber: number,
  clipId: string,
  textModel: TextModelId,
  done: Extract<TextDone, { _tag: 'Transcribed' }>,
) =>
  Effect.gen(function* () {
    const history = yield* HistoryStore
    const at = yield* Clock.currentTimeMillis
    const maybeClip = yield* history.setClipTranscript(clipId, {
      model: textModel,
      version: textModelVersion(textModel),
      device: done.device,
      at,
      pieces: done.pieces,
    })
    return Message.SucceededTextJob({
      jobNumber,
      maybeClip: Option.map(maybeClip, levelClipOf),
    })
  }).pipe(
    Effect.catch(error =>
      Effect.succeed(
        Message.FailedTextJob({ jobNumber, reason: error.reason }),
      ),
    ),
    Effect.uninterruptible,
  )

const keeping = (
  jobNumber: number,
  clipId: string,
  textModel: TextModelId,
  done: Extract<TextDone, { _tag: 'Transcribed' }>,
) =>
  Stream.unwrap(
    Effect.acquireRelease(
      Effect.forkDetach(keep(jobNumber, clipId, textModel, done), {
        uninterruptible: true,
      }),
      Fiber.await,
    ).pipe(
      Effect.map(fiber =>
        Stream.concat(
          Stream.make(
            Message.ProgressedTextJob({ jobNumber, step: TextStep.Keeping() }),
          ),
          Stream.fromEffect(Fiber.join(fiber)),
        ),
      ),
    ),
  )

export const textEvents = (
  jobNumber: number,
  purpose: TextPurpose,
  textModel: TextModelId,
): Stream.Stream<Message, never, Transcriber | HistoryStore | ClipStore> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const transcriber = yield* Transcriber
      const events = TextPurpose.match(purpose, {
        Download: () => transcriber.download(textModel),
        Transcribe: ({ clipId }) =>
          Stream.unwrap(
            Effect.map(clipToRead(clipId), ({ clip, file }) =>
              transcriber.transcribe(textModel, file, clip.lines),
            ),
          ),
      })
      return events.pipe(
        Stream.flatMap((event): Stream.Stream<Message, never, HistoryStore> => {
          if (event._tag === 'Downloaded') {
            return Stream.make(
              Message.SucceededTextJob({ jobNumber, maybeClip: Option.none() }),
            )
          }
          if (event._tag === 'Transcribed') {
            return purpose._tag === 'Transcribe'
              ? keeping(jobNumber, purpose.clipId, textModel, event)
              : Stream.empty
          }
          return Stream.make(
            Message.ProgressedTextJob({ jobNumber, step: stepOf(event) }),
          )
        }),
        Stream.catch(error =>
          Stream.succeed(
            Message.FailedTextJob({ jobNumber, reason: error.reason }),
          ),
        ),
      )
    }),
  )

const Job = Schema.Struct({
  jobNumber: Schema.Finite,
  purpose: TextPurpose,
  model: TextModelId,
})

export const textJobOf = (model: Model) =>
  model.textJob._tag === 'Working'
    ? Option.some({
        jobNumber: model.textJob.jobNumber,
        purpose: model.textJob.purpose,
        model: model.textJob.model,
      })
    : Option.none()

export const textSubscriptions = Subscription.make<Model, Message>()(entry => ({
  text: entry(
    { maybeJob: Schema.Option(Job) },
    {
      modelToDependencies: model => ({ maybeJob: textJobOf(model) }),
      dependenciesToStream: ({ maybeJob }) =>
        Option.match(maybeJob, {
          onNone: () => Stream.empty,
          onSome: ({ jobNumber, purpose, model }) =>
            textEvents(jobNumber, purpose, model).pipe(
              Stream.provide(
                Layer.mergeAll(
                  Transcriber.layer,
                  HistoryStore.layer,
                  ClipStore.layer,
                ),
              ),
            ),
        }),
    },
  ),
}))
