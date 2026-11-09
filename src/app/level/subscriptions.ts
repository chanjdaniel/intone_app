import { Effect, Layer, Option, Queue, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { ClipStore } from '../../services/clip-store'
import { HistoryStore } from '../../services/history-store'
import { Playback, PlaybackError } from '../../services/playback'
import { Message } from '../message'
import type { Model } from '../model'

// Playing the selected line on a clip's level, from where the play
// starts to the line's end, while the Model says it plays: leaving the
// state, by Stop, by a change or by leaving the screen, stops it at
// once. It says where it has got to about 20 times a second, which moves
// the playhead, and that it ended.

export const LevelPlayback = Schema.Struct({
  clipId: Schema.String,
  playNumber: Schema.Finite,
  from: Schema.Finite,
  to: Schema.Finite,
})
export type LevelPlayback = typeof LevelPlayback.Type

export const levelPlaybackOf = (model: Model): Option.Option<LevelPlayback> =>
  model.route._tag === 'Level' &&
  model.level._tag === 'Ready' &&
  model.level.clip.hasAudio &&
  model.level.editor.play._tag === 'Playing'
    ? Option.some({
        clipId: model.level.clip.id,
        playNumber: model.level.editor.play.playNumber,
        from: model.level.editor.play.from,
        to: model.level.editor.play.to,
      })
    : Option.none()

const noAudio = new PlaybackError({
  reason: 'The clip’s audio is no longer on this device.',
})

export const levelPlaybackEvents = ({
  clipId,
  playNumber,
  from,
  to,
}: LevelPlayback): Stream.Stream<
  Message,
  never,
  Playback | ClipStore | HistoryStore
> =>
  Stream.callback<Message, never, Playback | ClipStore | HistoryStore>(queue =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      const files = yield* ClipStore
      const playback = yield* Playback
      const maybeClip = yield* history
        .clip(clipId)
        .pipe(
          Effect.mapError(error => new PlaybackError({ reason: error.reason })),
        )
      const audio = Option.flatMap(maybeClip, clip =>
        Option.fromNullishOr(clip.audio),
      )
      if (Option.isNone(audio)) {
        return yield* noAudio
      }
      const maybeUrl = yield* files
        .url(audio.value.file, audio.value.type)
        .pipe(
          Effect.mapError(error => new PlaybackError({ reason: error.reason })),
        )
      if (Option.isNone(maybeUrl)) {
        return yield* noAudio
      }
      yield* playback.playLine(maybeUrl.value, 1, { from, to }, seconds => {
        Queue.offerUnsafe(
          queue,
          Message.MovedLevelPlayhead({
            playNumber,
            seconds: Math.min(to, seconds),
          }),
        )
      })
      Queue.offerUnsafe(queue, Message.EndedLevelPlayback({ playNumber }))
      Queue.endUnsafe(queue)
    }).pipe(
      Effect.catch(error =>
        Effect.sync(() => {
          Queue.offerUnsafe(
            queue,
            Message.FailedLevelPlayback({ playNumber, reason: error.reason }),
          )
          Queue.endUnsafe(queue)
        }),
      ),
    ),
  )

export const levelSubscriptions = Subscription.make<Model, Message>()(
  entry => ({
    levelPlayback: entry(
      { maybePlay: Schema.Option(LevelPlayback) },
      {
        modelToDependencies: model => ({ maybePlay: levelPlaybackOf(model) }),
        dependenciesToStream: ({ maybePlay }) =>
          Option.match(maybePlay, {
            onNone: () => Stream.empty,
            onSome: play =>
              levelPlaybackEvents(play).pipe(
                Stream.provide(
                  Layer.mergeAll(
                    Playback.layer,
                    ClipStore.layer,
                    HistoryStore.layer,
                  ),
                ),
              ),
          }),
      },
    ),
  }),
)
