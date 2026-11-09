import { Clock, Duration, Effect, Option, Ref, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { peakOf, toDb } from '../../engine/audio/level'
import { createOnsetFinder } from '../../engine/pitch/onset'
import { swiftF0FrameHz } from '../../engine/pitch/swift-f0'
import type { MicrophoneSession } from '../../services/microphone'
import type { TrackerSession } from '../../services/tracker'
import { Message } from '../message'
import type { Model } from '../model'
import {
  MicrophoneResource,
  type TakeResourceServices,
  TrackerResource,
} from './resources'
import { levelMeterFloorDb, recordingTake } from './take'

// While a take records: the microphone's batches go to the tracker Worker
// as they come, and its pitch frames go to the live curve's canvas
// (./liveFrames.ts), never through the Model. The Model hears only the
// coarse events: the voice's onset, once, and the level meter with the
// recording clock, ten times a second. The curve comes into the Model
// once, when the take ends (AnalyseTake in ./commands.ts).

export const meterInterval = Duration.millis(100)

// The take's events for the Model, from its microphone and tracker.
export const takeEvents = (
  takeNumber: number,
  microphone: MicrophoneSession,
  tracker: TrackerSession,
): Stream.Stream<Message> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* tracker.start(microphone.sampleRate)
      const startedAt = yield* Clock.currentTimeMillis
      // The loudest sample since the meter last read it. The batch's
      // buffer is handed to the Worker, so it is measured first.
      const loudest = yield* Ref.make(0)

      const forward = microphone.batches.pipe(
        Stream.mapEffect(batch =>
          Ref.update(loudest, peak => Math.max(peak, peakOf(batch))).pipe(
            Effect.andThen(tracker.push(batch)),
          ),
        ),
        Stream.drain,
      )
      const meter = Stream.tick(meterInterval).pipe(
        Stream.mapEffect(() =>
          Effect.all([Clock.currentTimeMillis, Ref.getAndSet(loudest, 0)]),
        ),
        Stream.map(([now, peak]) =>
          Message.TickedTakeMeter({
            takeNumber,
            elapsedSeconds: (now - startedAt) / 1000,
            levelDb: Math.min(0, Math.max(levelMeterFloorDb, toDb(peak))),
          }),
        ),
      )
      const onset = Stream.unwrap(
        Effect.sync(() => {
          const finder = createOnsetFinder()
          return tracker.frames.pipe(
            Stream.map(frames =>
              Option.fromNullishOr(finder.push(frames.firstFrame, frames.f0Hz)),
            ),
            Stream.filter(Option.isSome),
            Stream.take(1),
            Stream.map(onsetFrame =>
              Message.DetectedVoiceOnset({
                takeNumber,
                onsetSeconds: onsetFrame.value / swiftF0FrameHz,
              }),
            ),
          )
        }),
      )
      return Stream.mergeAll<Message, never, never>([forward, meter, onset], {
        concurrency: 'unbounded',
      })
    }),
  )

const recordTake = (
  takeNumber: number,
): Stream.Stream<Message, never, TakeResourceServices> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const microphone = yield* MicrophoneResource.get
      const tracker = yield* TrackerResource.get
      return takeEvents(takeNumber, microphone, tracker)
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
