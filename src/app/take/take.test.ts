import { Option, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { scoreTake } from '../../score/score'
import { syntheticTake } from '../../score/synthetic-take'
import { compareTake } from '../../services/compare-take'
import {
  TakeScore,
  recordingOfNative,
  takeCurveOf,
  takeFeaturesOf,
  takeScoreOf,
} from './take'

const line = [true, false, false, false, true]
const native = syntheticTake({
  pattern: line,
  moraFrames: 9,
  registerHz: 220,
  spanSemitones: 5,
  seed: 1,
})
const take = syntheticTake({
  pattern: line,
  moraFrames: 10,
  registerHz: 130,
  spanSemitones: 5,
  seed: 5,
})

describe('a take’s score in the Model', () => {
  test('scores the same from the native the Model keeps as from the tracker’s arrays', () => {
    const kept = recordingOfNative({
      curve: takeCurveOf(native.curve),
      features: takeFeaturesOf(native.features),
    })
    expect(kept).toStrictEqual(native)
    expect(scoreTake(kept, take)).toStrictEqual(scoreTake(native, take))
  })

  test('keeps the score’s fields, its parts by name, and the take lined up with the native', () => {
    const score = takeScoreOf(compareTake(native, take), native)
    const raw = scoreTake(native, take)
    if (score._tag !== 'Scored' || raw._tag !== 'Scored') {
      throw new Error('not scored')
    }
    expect(score.match).toBe(raw.match)
    expect(score.parts).toStrictEqual({
      pitchAccent: raw.parts.pitchAccent,
      timing: raw.parts.timing,
      maybeSounds: Option.none(),
    })
    expect(score.worstStretch).toStrictEqual(raw.worstStretch)
    expect(score.provisional).toBe(true)
    expect(score.version).toBe(1)
    expect(score.alignedF0).toHaveLength(native.curve.f0Hz.length)
    // A Schema value of the Model, as encoded and decoded.
    expect(
      Schema.decodeSync(TakeScore)(Schema.encodeSync(TakeScore)(score)),
    ).toStrictEqual(score)
  })

  test('keeps why a take could not be compared, and no number', () => {
    const long = syntheticTake({
      pattern: line,
      moraFrames: 30,
      registerHz: 130,
      spanSemitones: 5,
      seed: 5,
    })
    expect(takeScoreOf(compareTake(native, long), native)).toStrictEqual(
      TakeScore.CouldNotCompare({ version: 1, reason: 'LengthMismatch' }),
    )
  })
})
