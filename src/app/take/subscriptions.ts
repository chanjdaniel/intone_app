import { Clock, Duration, Effect, Option, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { Message } from '../message'
import type { Model } from '../model'
import {
  MicrophoneResource,
  type TakeResourceServices,
  TrackerResource,
} from './resources'
import { recordingTake } from './take'

// While a take records: the microphone's batches go to the tracker Worker
// as they come, never through the Model, and the Model hears only the
// recording clock, four times a second.

const clockInterval = Duration.millis(250)

const recordTake = (
  takeNumber: number,
): Stream.Stream<Message, never, TakeResourceServices> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const microphone = yield* MicrophoneResource.get
      const tracker = yield* TrackerResource.get
      yield* tracker.start(microphone.sampleRate)
      const startedAt = yield* Clock.currentTimeMillis

      const forward = microphone.batches.pipe(
        Stream.mapEffect(tracker.push),
        Stream.drain,
      )
      const clock = Stream.tick(clockInterval).pipe(
        Stream.mapEffect(() =>
          Clock.currentTimeMillis.pipe(
            Effect.map(now =>
              Message.TickedRecordingClock({
                takeNumber,
                elapsedSeconds: (now - startedAt) / 1000,
              }),
            ),
          ),
        ),
      )
      return Stream.merge(forward, clock).pipe(
        Stream.map((message): Message => message),
      )
    }).pipe(
      Effect.catchTag('ResourceNotAvailable', ({ resource }) =>
        Effect.succeed(
          Stream.make<ReadonlyArray<Message>>(
            Message.FailedRecordTake({
              takeNumber,
              reason: `The take lost its ${resource === 'TrackerResource' ? 'pitch tracker' : 'microphone'}.`,
            }),
          ),
        ),
      ),
    ),
  )

export const subscriptions = Subscription.make<
  Model,
  Message,
  TakeResourceServices
>()(entry => ({
  recording: entry(
    { maybeTakeNumber: Schema.Option(Schema.Finite) },
    {
      modelToDependencies: model => ({
        maybeTakeNumber: recordingTake(model.take),
      }),
      dependenciesToStream: ({ maybeTakeNumber }) =>
        Option.match(maybeTakeNumber, {
          onNone: () => Stream.empty,
          onSome: recordTake,
        }),
    },
  ),
}))
