import {
  Clock,
  Duration,
  Effect,
  Match,
  Option,
  Ref,
  Schema,
  Stream,
} from 'effect'
import { Subscription } from 'foldkit'

import { peakOf, toDb } from '../../engine/audio/level'
import { createOnsetFinder } from '../../engine/pitch/onset'
import { swiftF0FrameHz } from '../../engine/pitch/swift-f0'
import type { MicrophoneSession } from '../../services/microphone'
import { Playback, PlaybackError } from '../../services/playback'
import type { TrackerSession } from '../../services/tracker'
import { lineOf } from '../line/lines'
import { Message } from '../message'
import type { Model } from '../model'
import {
  MicrophoneResource,
  type TakeResourceServices,
  TrackerResource,
} from './resources'
import { levelMeterFloorDb, recordingTake } from './take'
import { keepTakeAudio, takeAudioOf } from './takeAudio'

// While a take records: the microphone's batches go to the tracker Worker
// as they come, a copy of each is kept in memory for the learner to hear
// (./takeAudio.ts), and the pitch frames go to the live curve's canvas
// (./liveFrames.ts), never through the Model. The Model hears only the
// coarse events: the voice's onset, once, and the level meter with the
// recording clock, ten times a second. The curve comes into the Model
// once, when the take ends (AnalyseTake in ./commands.ts).
//
// While the Model is playing a voice, it plays, and stops the moment the
// Model leaves that state: so a voice plays only in PlayingNative and
// Listening, never while the microphone is open.

export const meterInterval = Duration.millis(100)

// The take's events for the Model, from its microphone and tracker; each
// batch is given to `keep` before the tracker takes it.
export const takeEvents = (
  takeNumber: number,
  microphone: MicrophoneSession,
  tracker: TrackerSession,
  keep: (batch: Float32Array) => Effect.Effect<void>,
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
            Effect.andThen(keep(batch)),
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
      const keep = yield* keepTakeAudio(takeNumber, microphone.sampleRate)
      return takeEvents(takeNumber, microphone, tracker, keep)
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

// What the Model is playing now.
export const Play = Schema.Union([
  // The line, at its own speed, before take `takeNumber`.
  Schema.TaggedStruct('LineBeforeTake', {
    takeNumber: Schema.Finite,
    audioUrl: Schema.String,
  }),
  // The line again, `rate` times its speed.
  Schema.TaggedStruct('Line', { audioUrl: Schema.String, rate: Schema.Finite }),
  // The learner's take `takeNumber`, from memory.
  Schema.TaggedStruct('Take', { takeNumber: Schema.Finite }),
])
export type Play = typeof Play.Type

export const playOf = (model: Model): Option.Option<Play> => {
  if (model.route._tag !== 'Line') {
    return Option.none()
  }
  const maybeLine = lineOf(model.route.clipId, model.route.lineId)
  return Match.value(model.take).pipe(
    Match.tag('PlayingNative', ({ takeNumber }) =>
      Option.map(maybeLine, line => ({
        _tag: 'LineBeforeTake' as const,
        takeNumber,
        audioUrl: line.audioUrl,
      })),
    ),
    Match.tag('Listening', ({ voice, maybeTake }) =>
      voice === 'Line'
        ? Option.map(maybeLine, line => ({
            _tag: 'Line' as const,
            audioUrl: line.audioUrl,
            rate: model.listenSpeed,
          }))
        : Option.map(maybeTake, ({ takeNumber }) => ({
            _tag: 'Take' as const,
            takeNumber,
          })),
    ),
    Match.orElse(() => Option.none()),
  )
}

// Plays `play` once: the Message that says it ended, or why it did not
// play.
export const playbackEvents = (
  play: Play,
): Stream.Stream<Message, never, Playback> =>
  Stream.fromEffect(
    Effect.gen(function* () {
      const playback = yield* Playback
      return yield* Match.value(play).pipe(
        Match.tagsExhaustive({
          LineBeforeTake: ({ takeNumber, audioUrl }) =>
            playback
              .playLine(audioUrl, 1)
              .pipe(Effect.as(Message.EndedNativeBeforeTake({ takeNumber }))),
          Line: ({ audioUrl, rate }) =>
            playback
              .playLine(audioUrl, rate)
              .pipe(Effect.as(Message.EndedListening({ voice: 'Line' }))),
          Take: ({ takeNumber }) =>
            takeAudioOf(takeNumber).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new PlaybackError({
                        reason: 'Your take is no longer in memory.',
                      }),
                    ),
                  onSome: audio =>
                    playback.playTake(audio.samples, audio.sampleRate),
                }),
              ),
              Effect.as(Message.EndedListening({ voice: 'Take' })),
            ),
        }),
      )
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(Message.FailedPlayback({ reason: error.reason })),
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
  playback: entry(
    { maybePlay: Schema.Option(Play) },
    {
      modelToDependencies: model => ({ maybePlay: playOf(model) }),
      dependenciesToStream: ({ maybePlay }) =>
        Option.match(maybePlay, {
          onNone: () => Stream.empty,
          onSome: play =>
            playbackEvents(play).pipe(Stream.provide(Playback.layer)),
        }),
    },
  ),
}))
