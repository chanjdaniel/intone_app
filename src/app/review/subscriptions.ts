import { Effect, Option, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { Playback } from '../../services/playback'
import { starterAudioUrl, starterPack } from '../line/starter'
import { Message } from '../message'
import type { Model } from '../model'

// Playing a starter line on /review while the Model says it plays, at
// its own speed: Stop, another line or leaving the page stops it at once.

export const ReviewPlaying = Schema.Struct({
  lineId: Schema.String,
  playNumber: Schema.Finite,
})
export type ReviewPlaying = typeof ReviewPlaying.Type

export const reviewPlayingOf = (model: Model): Option.Option<ReviewPlaying> =>
  model.route._tag === 'Review' &&
  model.review._tag === 'Ready' &&
  model.review.play._tag === 'Playing'
    ? Option.some({
        lineId: model.review.play.lineId,
        playNumber: model.review.play.playNumber,
      })
    : Option.none()

export const reviewPlayEvents = ({
  lineId,
  playNumber,
}: ReviewPlaying): Stream.Stream<Message, never, Playback> =>
  Stream.fromEffect(
    Effect.gen(function* () {
      const line = starterPack.levels
        .flatMap(level => level.lines)
        .find(found => found.id === lineId)
      if (line === undefined) {
        return Message.FailedReviewPlay({
          playNumber,
          reason: 'The starter set has no such line.',
        })
      }
      const playback = yield* Playback
      yield* playback.playLine(starterAudioUrl(line), 1)
      return Message.EndedReviewPlay({ playNumber })
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedReviewPlay({ playNumber, reason: error.reason }),
        ),
      ),
    ),
  )

export const reviewSubscriptions = Subscription.make<Model, Message>()(
  entry => ({
    reviewPlayback: entry(
      { maybePlay: Schema.Option(ReviewPlaying) },
      {
        modelToDependencies: model => ({ maybePlay: reviewPlayingOf(model) }),
        dependenciesToStream: ({ maybePlay }) =>
          Option.match(maybePlay, {
            onNone: () => Stream.empty,
            onSome: play =>
              reviewPlayEvents(play).pipe(Stream.provide(Playback.layer)),
          }),
      },
    ),
  }),
)
