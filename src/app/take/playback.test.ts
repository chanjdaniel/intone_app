import { Effect, Fiber, Layer, Stream } from 'effect'
import { TestClock } from 'effect/testing'

import { describe, expect, it } from '@effect/vitest'

import { type Heard, Playback } from '../../services/playback'
import { Message } from '../message'
import { playbackEvents } from './subscriptions'
import { forgetTakeAudio, keepTakeAudio } from './takeAudio'

// The playback Subscription's stream on the playback test layer: what it
// plays, and the one Message it ends with.
const run = (play: Parameters<typeof playbackEvents>[0], heard: Array<Heard>) =>
  playbackEvents(play).pipe(
    Stream.runCollect,
    Effect.provide(Layer.fresh(Playback.layerTest(heard, 1.2))),
  )

describe('playing a voice', () => {
  it.effect('plays the line before a take at its own speed, then says so', () =>
    Effect.gen(function* () {
      const heard: Array<Heard> = []
      const fiber = yield* run(
        { _tag: 'LineBeforeTake', takeNumber: 4, audioUrl: '/line.wav' },
        heard,
      ).pipe(Effect.forkChild)
      yield* TestClock.adjust('1200 millis')
      expect(yield* Fiber.join(fiber)).toStrictEqual([
        Message.EndedNativeBeforeTake({ takeNumber: 4 }),
      ])
      expect(heard).toStrictEqual([
        { voice: 'Line', url: '/line.wav', rate: 1 },
      ])
    }),
  )

  it.effect(
    'plays the line again slowed, for twice as long at half speed',
    () =>
      Effect.gen(function* () {
        const heard: Array<Heard> = []
        const fiber = yield* run(
          { _tag: 'Line', audioUrl: '/line.wav', rate: 0.5 },
          heard,
        ).pipe(Effect.forkChild)
        yield* TestClock.adjust('2399 millis')
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust('1 millis')
        expect(yield* Fiber.join(fiber)).toStrictEqual([
          Message.EndedListening({ voice: 'Line', extent: 'Whole' }),
        ])
        expect(heard).toStrictEqual([
          { voice: 'Line', url: '/line.wav', rate: 0.5 },
        ])
      }),
  )

  it.effect('plays the take from memory, or says it is gone', () =>
    Effect.gen(function* () {
      const keep = yield* keepTakeAudio(7, 48_000)
      yield* keep(new Float32Array(24_000))
      const heard: Array<Heard> = []
      const fiber = yield* run({ _tag: 'Take', takeNumber: 7 }, heard).pipe(
        Effect.forkChild,
      )
      yield* TestClock.adjust('500 millis')
      expect(yield* Fiber.join(fiber)).toStrictEqual([
        Message.EndedListening({ voice: 'Take', extent: 'Whole' }),
      ])
      expect(heard).toStrictEqual([
        { voice: 'Take', samples: 24_000, sampleRate: 48_000 },
      ])

      yield* forgetTakeAudio
      expect(yield* run({ _tag: 'Take', takeNumber: 7 }, [])).toStrictEqual([
        Message.FailedPlayback({ reason: 'Your take is no longer in memory.' }),
      ])
    }),
  )
})
