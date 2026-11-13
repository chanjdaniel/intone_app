import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { forgetTakeAudio, keepTakeAudio, takeAudioOf } from './takeAudio'

describe('the take’s audio, in memory', () => {
  it.effect(
    'keeps a copy of each batch, the last take’s only, until forgotten',
    () =>
      Effect.gen(function* () {
        const keepFirst = yield* keepTakeAudio(1, 48_000)
        const batch = Float32Array.of(0.1, 0.2)
        yield* keepFirst(batch)
        // The batch is handed on afterwards, so its own buffer may go.
        batch.fill(0)
        yield* keepFirst(Float32Array.of(0.3))
        const first = yield* takeAudioOf(1)
        expect(
          Option.map(first, audio => Array.from(audio.samples)),
        ).toStrictEqual(Option.some([0.1, 0.2, 0.3].map(Math.fround)))
        expect(Option.map(first, audio => audio.sampleRate)).toStrictEqual(
          Option.some(48_000),
        )

        const keepSecond = yield* keepTakeAudio(2, 44_100)
        yield* keepSecond(Float32Array.of(0.5))
        expect(yield* takeAudioOf(1)).toStrictEqual(Option.none())
        expect(Option.isSome(yield* takeAudioOf(2))).toBe(true)

        yield* forgetTakeAudio
        expect(yield* takeAudioOf(2)).toStrictEqual(Option.none())
      }),
  )
})
