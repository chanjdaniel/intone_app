import {
  Clock,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Ref,
  Schema,
  Stream,
} from 'effect'
import { Subscription } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'

import { peakOf, toDb } from '../../engine/audio/level'
import { createOnsetFinder } from '../../engine/pitch/onset'
import { swiftF0FrameHz } from '../../engine/pitch/swift-f0'
import { ClipStore } from '../../services/clip-store'
import type { MicrophoneSession } from '../../services/microphone'
import { Playback, PlaybackError } from '../../services/playback'
import type { TrackerSession } from '../../services/tracker'
import { LineAudio } from '../line/lines'
import { Message } from '../message'
import type { Model } from '../model'
import {
  MicrophoneResource,
  type TakeResourceServices,
  TrackerResource,
} from './resources'
import { levelMeterFloorDb, recordingTake, worstStretchOf } from './take'
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

const meterInterval = Duration.millis(100)

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
      const lost = Stream.fromEffect(microphone.ended).pipe(
        Stream.map(() =>
          Message.FailedRecordTake({
            takeNumber,
            reason:
              'The microphone stopped during the take: it was unplugged, or the browser took back its permission.',
          }),
        ),
      )
      return Stream.mergeAll<Message, never, never>(
        [forward, meter, onset, lost],
        { concurrency: 'unbounded' },
      )
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

// Seconds from a recording's start.
const Stretch = Schema.Struct({ from: Schema.Finite, to: Schema.Finite })
type Stretch = typeof Stretch.Type

// What the Model is playing now.
export const Play = defineTaggedUnion({
  // The line, at its own speed, before take `takeNumber`.
  LineBeforeTake: { takeNumber: Schema.Finite, audio: LineAudio },
  // The line again, `rate` times its speed.
  Line: { audio: LineAudio, rate: Schema.Finite },
  // The learner's take `takeNumber`, from memory.
  Take: { takeNumber: Schema.Finite },
  // A scored take's worst stretch of the line, `rate` times its speed.
  LineStretch: { audio: LineAudio, rate: Schema.Finite, stretch: Stretch },
  // The part of take `takeNumber` paired with that stretch, from memory.
  TakeStretch: { takeNumber: Schema.Finite, stretch: Stretch },
})
export type Play = typeof Play.Type

export const playOf = (model: Model): Option.Option<Play> => {
  if (model.route._tag !== 'Line' || model.native._tag !== 'Ready') {
    return Option.none()
  }
  const audio = model.native.line.audio
  return Match.value(model.take).pipe(
    Match.tag('PlayingNative', ({ takeNumber }) =>
      Option.some(Play.LineBeforeTake({ takeNumber, audio })),
    ),
    Match.tag(
      'Listening',
      ({ voice, extent, maybeTake }): Option.Option<Play> => {
        if (extent === 'WorstStretch') {
          return Option.flatMap(maybeTake, ({ takeNumber, result }) =>
            Option.map(worstStretchOf(result), (worst): Play =>
              voice === 'Line'
                ? Play.LineStretch({
                    audio,
                    rate: model.listenSpeed,
                    stretch: { from: worst.nativeFrom, to: worst.nativeTo },
                  })
                : Play.TakeStretch({
                    takeNumber,
                    stretch: { from: worst.takeFrom, to: worst.takeTo },
                  }),
            ),
          )
        }
        return voice === 'Line'
          ? Option.some(Play.Line({ audio, rate: model.listenSpeed }))
          : Option.map(maybeTake, ({ takeNumber }) => Play.Take({ takeNumber }))
      },
    ),
    Match.orElse(() => Option.none()),
  )
}

// Plays the line's audio once at `rate`: a bundled file from the app's
// origin, or the line's stretch of the learner's clip from the clip
// store; `stretch` is a part of the line, in seconds from its start.
const playLineAudio = (
  audio: LineAudio,
  rate: number,
  stretch?: Stretch,
): Effect.Effect<void, PlaybackError, Playback | ClipStore> =>
  Effect.gen(function* () {
    const playback = yield* Playback
    if (audio._tag === 'Bundled') {
      return yield* playback.playLine(audio.url, rate, stretch)
    }
    const files = yield* ClipStore
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const maybeUrl = yield* files
          .url(audio.file, audio.type)
          .pipe(
            Effect.mapError(
              error => new PlaybackError({ reason: error.reason }),
            ),
          )
        if (Option.isNone(maybeUrl)) {
          return yield* new PlaybackError({
            reason: 'The clip’s audio is no longer on this device.',
          })
        }
        return yield* playback.playLine(
          maybeUrl.value,
          rate,
          stretch === undefined
            ? { from: audio.from, to: audio.to }
            : {
                from: audio.from + stretch.from,
                to: Math.min(audio.to, audio.from + stretch.to),
              },
        )
      }),
    )
  })

// Plays `play` once: the Message that says it ended, or why it did not
// play.
export const playbackEvents = (
  play: Play,
): Stream.Stream<Message, never, Playback | ClipStore> =>
  Stream.fromEffect(
    Effect.gen(function* () {
      const playback = yield* Playback
      const playTake = (
        takeNumber: number,
        stretch?: Readonly<{ from: number; to: number }>,
      ) =>
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
                playback.playTake(audio.samples, audio.sampleRate, stretch),
            }),
          ),
        )
      return yield* Match.value(play).pipe(
        Match.tagsExhaustive({
          LineBeforeTake: ({ takeNumber, audio }) =>
            playLineAudio(audio, 1).pipe(
              Effect.as(Message.EndedNativeBeforeTake({ takeNumber })),
            ),
          Line: ({ audio, rate }) =>
            playLineAudio(audio, rate).pipe(
              Effect.as(
                Message.EndedListening({ voice: 'Line', extent: 'Whole' }),
              ),
            ),
          Take: ({ takeNumber }) =>
            playTake(takeNumber).pipe(
              Effect.as(
                Message.EndedListening({ voice: 'Take', extent: 'Whole' }),
              ),
            ),
          LineStretch: ({ audio, rate, stretch }) =>
            playLineAudio(audio, rate, stretch).pipe(
              Effect.as(
                Message.EndedListening({
                  voice: 'Line',
                  extent: 'WorstStretch',
                }),
              ),
            ),
          TakeStretch: ({ takeNumber, stretch }) =>
            playTake(takeNumber, stretch).pipe(
              Effect.as(
                Message.EndedListening({
                  voice: 'Take',
                  extent: 'WorstStretch',
                }),
              ),
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
            playbackEvents(play).pipe(
              Stream.provide(Layer.merge(Playback.layer, ClipStore.layer)),
            ),
        }),
    },
  ),
}))
