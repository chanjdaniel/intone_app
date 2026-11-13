import { Effect, Fiber, Layer, Stream } from 'effect'
import { TestClock } from 'effect/testing'

import { describe, expect, it } from '@effect/vitest'

import { ClipStore } from '../../services/clip-store'
import { type Heard, Playback } from '../../services/playback'
import { LineAudio } from '../line/lines'
import { Message } from '../message'
import { playbackEvents } from './subscriptions'
import { forgetTakeAudio, keepTakeAudio } from './takeAudio'

// The playback Subscription's stream on the playback test layer: what it
// plays, and the one Message it ends with.
const run = (
  play: Parameters<typeof playbackEvents>[0],
  heard: Array<Heard>,
  files: Map<string, Uint8Array> = new Map(),
) =>
  playbackEvents(play).pipe(
    Stream.runCollect,
    Effect.provide(
      Layer.merge(
        Layer.fresh(Playback.layerTest(heard, 1.2)),
        ClipStore.layerMemory(files),
      ),
    ),
  )

describe('playing a voice', () => {
  it.effect('plays the line before a take at its own speed, then says so', () =>
    Effect.gen(function* () {
      const heard: Array<Heard> = []
      const fiber = yield* run(
        {
          _tag: 'LineBeforeTake',
          takeNumber: 4,
          audio: LineAudio.Bundled({ url: '/line.wav' }),
        },
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
          {
            _tag: 'Line',
            audio: LineAudio.Bundled({ url: '/line.wav' }),
            rate: 0.5,
          },
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

  it.effect(
    'plays a line of the learner’s clip from the clip store, its own stretch of the file',
    () =>
      Effect.gen(function* () {
        const heard: Array<Heard> = []
        const files = new Map([['clips/c1.mp3', Uint8Array.of(1, 2, 3)]])
        const audio = LineAudio.Clip({
          file: 'clips/c1.mp3',
          type: 'audio/mpeg',
          from: 3.5,
          to: 6,
        })
        const whole = yield* run(
          { _tag: 'Line', audio, rate: 1 },
          heard,
          files,
        ).pipe(Effect.forkChild)
        yield* TestClock.adjust('2500 millis')
        expect(yield* Fiber.join(whole)).toStrictEqual([
          Message.EndedListening({ voice: 'Line', extent: 'Whole' }),
        ])
        const worst = yield* run(
          {
            _tag: 'LineStretch',
            audio,
            rate: 0.5,
            stretch: { from: 0.2, to: 0.6 },
          },
          heard,
          files,
        ).pipe(Effect.forkChild)
        yield* TestClock.adjust('800 millis')
        yield* Fiber.join(worst)
        expect(heard).toMatchObject([
          { voice: 'Line', rate: 1, stretch: { from: 3.5, to: 6 } },
          { voice: 'Line', rate: 0.5, stretch: { from: 3.7, to: 4.1 } },
        ])
        heard.forEach(played => {
          expect(
            played.voice === 'Line' && played.url.startsWith('blob:'),
          ).toBe(true)
        })
      }),
  )

  it.effect('says when a clip’s file is no longer on the device', () =>
    Effect.gen(function* () {
      const heard: Array<Heard> = []
      const said = yield* run(
        {
          _tag: 'LineBeforeTake',
          takeNumber: 2,
          audio: LineAudio.Clip({
            file: 'clips/gone.mp3',
            type: '',
            from: 0,
            to: 2,
          }),
        },
        heard,
      )
      expect(said).toStrictEqual([
        Message.FailedPlayback({
          reason: 'The clip’s audio is no longer on this device.',
        }),
      ])
      expect(heard).toStrictEqual([])
    }),
  )
})
