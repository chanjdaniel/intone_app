import { Effect, Exit, Fiber, Option, PubSub, Stream, type Take } from 'effect'
import { TestClock } from 'effect/testing'
import { given, message, model, story } from 'foldkit/story'

import { describe, expect, it } from '@effect/vitest'

import type { MicrophoneSession } from '../../services/microphone'
import type { LiveFrames, TrackerSession } from '../../services/tracker'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { takeEvents } from './subscriptions'
import { Take as TakeState, levelMeterFloorDb } from './take'

// A take of 3 s in 20 ms batches: silence, then from 0.5 s a voice
// peaking at half of full scale.
const batchCount = 150
const voiceFromBatch = 25

// A microphone that plays the take in real time, by the test clock.
const microphone: MicrophoneSession = {
  sampleRate: 48_000,
  settings: {},
  batches: Stream.tick('20 millis').pipe(
    Stream.take(batchCount),
    Stream.mapAccum(
      () => 0,
      (batch: number) => [
        batch + 1,
        [new Float32Array(960).fill(batch >= voiceFromBatch ? 0.5 : 0)],
      ],
    ),
  ),
}

// A tracker that answers each batch with the frames it completes, 1.25 a
// batch, voiced once the voice starts, as the Worker would.
const trackerOf = Effect.gen(function* () {
  const frames = yield* PubSub.unbounded<Take.Take<LiveFrames>>({
    replay: 1024,
  })
  let pushed = 0
  let framesOut = 0
  const session: TrackerSession = {
    start: () => Effect.void,
    push: () =>
      Effect.sync(() => {
        pushed++
        const complete = Math.floor((pushed * 320) / 256)
        const f0Hz = new Float32Array(complete - framesOut).fill(
          pushed > voiceFromBatch ? 150 : 0,
        )
        if (f0Hz.length > 0) {
          PubSub.publishUnsafe(frames, [{ firstFrame: framesOut, f0Hz }])
        }
        framesOut = complete
      }),
    finish: Effect.die('not asked'),
    frames: Stream.fromPubSubTake(frames),
  }
  return {
    session,
    framesOut: () => framesOut,
    end: () => PubSub.endUnsafe(frames, Exit.void),
  }
})

const recording = (takeNumber: number): Model => ({
  ...initialModel(AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })),
  take: TakeState.Recording({
    mode: 'Guided',
    takeNumber,
    elapsedSeconds: 0,
    levelDb: levelMeterFloorDb,
    maybeOnsetSeconds: Option.none(),
  }),
  takesStarted: takeNumber,
})

describe('the take, as its Model hears it', () => {
  it.effect(
    'hears the onset once and the meter ten times a second, never a pitch frame',
    () =>
      Effect.gen(function* () {
        const tracker = yield* trackerOf
        const heard: Array<Message> = []
        const kept: Array<Float32Array> = []
        const listening = yield* takeEvents(
          3,
          microphone,
          tracker.session,
          batch => Effect.sync(() => kept.push(batch.slice())),
        ).pipe(
          Stream.runForEach(event => Effect.sync(() => heard.push(event))),
          Effect.forkChild,
        )
        yield* Effect.yieldNow
        // The take plays out 10 ms at a time.
        for (let step = 0; step < 305; step++) {
          yield* TestClock.adjust('10 millis')
        }
        yield* Fiber.interrupt(listening)

        const onsets = heard.filter(
          event => event._tag === 'DetectedVoiceOnset',
        )
        const meters = heard.filter(event => event._tag === 'TickedTakeMeter')
        // 187 frames came, and none of them as a Message.
        expect(tracker.framesOut()).toBe(187)
        expect(onsets).toStrictEqual([
          Message.DetectedVoiceOnset({ takeNumber: 3, onsetSeconds: 0.496 }),
        ])
        // A meter reading about every 100 ms through the 3 s (each tick
        // waits from the last one's reading, here one 10 ms step late),
        // and the silence before the voice at the meter's floor.
        expect(meters).toHaveLength(31)
        meters.slice(1).forEach((meter, i) => {
          const gap = meter.elapsedSeconds - (meters[i]?.elapsedSeconds ?? 0)
          expect(gap).toBeGreaterThanOrEqual(0.1 - 1e-9)
          expect(gap).toBeLessThanOrEqual(0.11 + 1e-9)
        })
        expect(
          meters
            .filter(meter => meter.elapsedSeconds < 0.45)
            .map(meter => meter.levelDb),
        ).toStrictEqual([
          levelMeterFloorDb,
          levelMeterFloorDb,
          levelMeterFloorDb,
          levelMeterFloorDb,
          levelMeterFloorDb,
        ])
        expect(heard).toHaveLength(onsets.length + meters.length)
        // Every batch was kept for the learner to hear, before the tracker
        // took it.
        expect(kept).toHaveLength(batchCount)
        expect(kept[voiceFromBatch]?.[0]).toBe(0.5)

        const last = meters.at(-1)
        story(
          update,
          given(recording(3)),
          ...heard.map(event => message(event)),
          model(state => {
            expect(state.take).toStrictEqual(
              TakeState.Recording({
                mode: 'Guided',
                takeNumber: 3,
                elapsedSeconds: last?.elapsedSeconds ?? Number.NaN,
                levelDb: 20 * Math.log10(0.5),
                maybeOnsetSeconds: Option.some(0.496),
              }),
            )
          }),
        )
      }),
  )
})
