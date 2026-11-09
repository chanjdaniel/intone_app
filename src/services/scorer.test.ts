import { Effect } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { scoreTake } from '../score/score'
import { syntheticTake } from '../score/synthetic-take'
import { Scorer } from './scorer'

// The Scorer on synthetic recordings of 雨が好き's shape.
const line = [true, false, false, false, true]
const native = syntheticTake({
  pattern: line,
  moraFrames: 9,
  registerHz: 220,
  spanSemitones: 5,
  seed: 1,
})
const takeOf = (moraFrames: number) =>
  syntheticTake({
    pattern: line,
    moraFrames,
    registerHz: 130,
    spanSemitones: 5,
    seed: 3,
    colour: 1.5,
  })

const scored = (take: ReturnType<typeof takeOf>) =>
  Scorer.use(scorer => scorer.score(native, take)).pipe(
    Effect.provide(Scorer.layer),
  )

describe('the Scorer', () => {
  it.effect(
    'scores a take with the score’s own function, and lines its pitch up with the native’s frames',
    () =>
      Effect.gen(function* () {
        const take = takeOf(11)
        const { score, alignedTakeF0 } = yield* scored(take)
        expect(score).toStrictEqual(scoreTake(native, take))
        expect(score._tag).toBe('Scored')
        expect(alignedTakeF0?.length).toBe(native.curve.f0Hz.length)
        // Voiced where the native speaks, as the take does there.
        const voiced = Array.from(alignedTakeF0 ?? []).filter(hz => hz > 0)
        expect(voiced.length).toBeGreaterThan(40)
        expect(Math.min(...voiced)).toBeGreaterThan(100)
      }),
  )

  it.effect('has no aligned pitch for a take it could not compare', () =>
    Effect.gen(function* () {
      const { score, alignedTakeF0 } = yield* scored(takeOf(30))
      expect(score).toMatchObject({
        _tag: 'CouldNotCompare',
        reason: 'LengthMismatch',
      })
      expect(alignedTakeF0).toBeNull()
    }),
  )

  it.effect('answers with its test layer’s comparison, with no maths', () =>
    Effect.gen(function* () {
      const answer = {
        score: {
          _tag: 'CouldNotCompare',
          version: 1,
          reason: 'TooQuiet',
        } as const,
        alignedTakeF0: null,
      }
      const got = yield* Scorer.use(scorer =>
        scorer.score(native, takeOf(9)),
      ).pipe(Effect.provide(Scorer.layerTest(() => answer)))
      expect(got).toBe(answer)
    }),
  )
})
