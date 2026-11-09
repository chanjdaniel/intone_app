import { describe, expect, it } from 'vitest'

import { SCORE_VERSION, gainBand, worstStretchSeconds } from './constants'
import { type Score, scoreDetail, scoreTake } from './score'
import {
  type SyntheticTake,
  frameHz,
  syntheticTake,
  withF0,
  withGap,
} from './synthetic-take'

// The score's properties on synthetic takes (report section 3, spec
// "Testing Decisions"): each take differs from the native in one way at a
// time, over many seeds and lengths.

// 雨が好き's shape, atamadaka then a rise: H L L L H.
const line = [true, false, false, false, true]
const native: SyntheticTake = {
  pattern: line,
  moraFrames: 9,
  registerHz: 220,
  spanSemitones: 5,
  seed: 1,
}
// A right take in another voice: its own register, durations, colour and
// noise.
const rightTake = (seed: number, change: Partial<SyntheticTake> = {}) =>
  syntheticTake({
    pattern: line,
    moraFrames: line.map((_, k) => 8 + ((seed * 7 + k * 3) % 4)),
    registerHz: 130,
    spanSemitones: 5,
    seed: 100 + seed,
    colour: 1.5,
    ...change,
  })
const seeds = Array.from({ length: 12 }, (_, k) => k + 1)

const scored = (score: Score) => {
  if (score._tag !== 'Scored') {
    throw new Error(`could not compare: ${score.reason}`)
  }
  return score
}

describe('scoreTake', () => {
  it('carries the scoring version, 1, and says its scale is provisional', () => {
    expect(SCORE_VERSION).toBe(1)
    const score = scored(scoreTake(syntheticTake(native), rightTake(1)))
    expect(score.version).toBe(1)
    expect(score.provisional).toBe(true)
    const refused = scoreTake(
      syntheticTake(native),
      rightTake(1, { moraFrames: 30 }),
    )
    expect(refused).toMatchObject({ _tag: 'CouldNotCompare', version: 1 })
  })

  it('scores a right take high and a wrong accent low', () => {
    for (const seed of seeds) {
      const right = scored(scoreTake(syntheticTake(native), rightTake(seed)))
      const wrong = scored(
        scoreTake(
          syntheticTake(native),
          rightTake(seed, { pattern: [false, true, true, false, true] }),
        ),
      )
      expect(right.parts.pitchAccent).toBeGreaterThan(0.9)
      expect(wrong.parts.pitchAccent).toBeLessThan(0.3)
      expect(wrong.match).toBeLessThan(right.match)
    }
  })

  it('ignores the take’s register', () => {
    for (const seed of seeds) {
      const take = rightTake(seed)
      const before = scoreDetail(syntheticTake(native), take)
      for (const semitones of [-14, -5, 3, 12]) {
        const shifted = withF0(take, hz => hz * 2 ** (semitones / 12))
        const after = scoreDetail(syntheticTake(native), shifted)
        // The curve holds float32 Hz, so a shift rounds each frame anew.
        expect(Math.abs(after.pitchSkill - before.pitchSkill)).toBeLessThan(
          1e-6,
        )
        expect(after.score._tag).toBe('Scored')
        expect(after.tempoDeviation).toBe(before.tempoDeviation)
      }
    }
  })

  it('ignores the take’s span inside the gain band, within 0.01', () => {
    for (const seed of seeds) {
      const take = rightTake(seed)
      const before = scoreDetail(syntheticTake(native), take)
      for (const span of [0.5, 0.6, 0.8, 1.25, 1.6, 2]) {
        // The take's movement scaled around its own median.
        const median = 130
        const scaled = withF0(take, hz => median * (hz / median) ** span)
        const after = scoreDetail(syntheticTake(native), scaled)
        expect(
          Math.abs(after.pitchSkill - before.pitchSkill),
          `seed ${seed}, span x${span}`,
        ).toBeLessThan(0.01)
      }
    }
  })

  it('stops ignoring span outside the gain band', () => {
    const take = rightTake(1)
    const before = scoreDetail(syntheticTake(native), take).pitchSkill
    const timid = withF0(take, hz => 130 * (hz / 130) ** 0.2)
    expect(scoreDetail(syntheticTake(native), timid).pitchSkill).toBeLessThan(
      before - 0.3,
    )
  })

  it('scores a flat take near zero at any length', () => {
    for (const morae of [2, 5, 12, 30, 60]) {
      const pattern = Array.from(
        { length: morae },
        (_, k) => k === 0 || k % 4 === 1,
      )
      const lineNative = syntheticTake({ ...native, pattern })
      for (const seed of seeds.slice(0, 4)) {
        const flat = syntheticTake({
          ...native,
          pattern,
          registerHz: 140,
          spanSemitones: 0,
          seed: 200 + seed,
          colour: 1,
        })
        const score = scored(scoreTake(lineNative, flat))
        expect(score.parts.pitchAccent, `${morae} morae`).toBeLessThan(0.05)
      }
    }
  })

  it('keeps the timing part of a right take said uniformly slower or faster', () => {
    for (const seed of seeds) {
      const base = scored(
        scoreTake(syntheticTake(native), rightTake(seed, { moraFrames: 9 })),
      )
      for (const frames of [6, 7, 12, 14, 17]) {
        const paced = scored(
          scoreTake(
            syntheticTake(native),
            rightTake(seed, { moraFrames: frames }),
          ),
        )
        expect(paced.parts.timing, `${frames} frames a mora`).toBeGreaterThan(
          0.95,
        )
        expect(Math.abs(paced.parts.timing - base.parts.timing)).toBeLessThan(
          0.05,
        )
      }
    }
  })

  it('lowers the timing part of a take that holds one mora and rushes another', () => {
    for (const seed of seeds) {
      const steady = scored(
        scoreTake(syntheticTake(native), rightTake(seed, { moraFrames: 9 })),
      )
      const uneven = scored(
        scoreTake(
          syntheticTake(native),
          rightTake(seed, { moraFrames: [9, 18, 4, 9, 9] }),
        ),
      )
      expect(uneven.parts.timing).toBeLessThan(steady.parts.timing - 0.1)
    }
  })

  it('moves the pitch skill by under 0.05 for octave jumps in one frame in 20', () => {
    for (const seed of seeds) {
      const take = rightTake(seed)
      const before = scoreDetail(syntheticTake(native), take)
      let voiced = 0
      const jumped = withF0(take, hz => {
        voiced++
        return voiced % 20 === 0 ? hz * (voiced % 40 === 0 ? 2 : 0.5) : hz
      })
      const after = scoreDetail(syntheticTake(native), jumped)
      expect(Math.abs(after.pitchSkill - before.pitchSkill)).toBeLessThan(0.05)
    }
  })

  it('never counts missing pitch as an error', () => {
    const lineNative = syntheticTake(native)
    // The native's own frames as the take: a perfect copy, skill 1. Frames
    // in a gap are left out, so a gap where the pitch holds costs only
    // what the octave filter's edge moves the frames beside it by, the
    // jitter's size, however long the gap; native frames 20 to 28 and 38
    // to 55 hold level.
    for (const [from, length] of [
      [22, 2],
      [22, 4],
      [40, 3],
      [40, 6],
      [38, 12],
    ] as const) {
      const gapped = withGap(lineNative, from, from + length)
      const take = scoreDetail(lineNative, gapped).pitchSkill
      expect(take, `${length} frames from ${from}`).toBeGreaterThan(0.98)
      // ...and a gap in the native is no error either.
      expect(scoreDetail(gapped, lineNative).pitchSkill).toBeGreaterThan(0.98)
    }
    // Across the fall, only the octave filter's edge moves: the frame
    // beside the gap is filtered from one side. Bridging the gap, as the
    // painter does, would count the line's guess as the take's pitch and
    // cost 0.26.
    for (const length of [2, 4, 6, 9]) {
      const gapped = withGap(lineNative, 30, 30 + length)
      expect(scoreDetail(lineNative, gapped).pitchSkill).toBeGreaterThan(0.85)
    }
  })

  it('marks the 400 ms of the native where the take strays, mapped to the take', () => {
    for (const seed of seeds) {
      // The take holds the fourth mora high, said half again as slowly.
      const pattern = [true, false, false, true, true]
      const take = rightTake(seed, { pattern, moraFrames: 14, leadFrames: 30 })
      const score = scored(scoreTake(syntheticTake(native), take))
      const { nativeFrom, nativeTo, takeFrom, takeTo } = score.worstStretch
      expect(nativeTo - nativeFrom).toBeCloseTo(worstStretchSeconds, 1)
      // The fourth mora: native frames 47 to 56, take frames 72 to 86.
      const overlap = (from: number, to: number, a: number, b: number) =>
        Math.min(to, b / frameHz) - Math.max(from, a / frameHz)
      expect(overlap(nativeFrom, nativeTo, 47, 56)).toBeGreaterThan(0.08)
      expect(overlap(takeFrom, takeTo, 72, 86)).toBeGreaterThan(0.12)
      expect(takeTo - takeFrom).toBeGreaterThan((nativeTo - nativeFrom) * 1.2)
    }
  })

  it('cannot compare a take too little voiced, too far off in length, or too quiet', () => {
    const lineNative = syntheticTake(native)
    // Voiced for a third of the native's frames.
    const sparse = withGap(rightTake(1, { moraFrames: 9 }), 32, 62)
    expect(scoreTake(lineNative, sparse)).toMatchObject({
      _tag: 'CouldNotCompare',
      reason: 'TooLittleVoiced',
    })
    const quiet = withGap(
      rightTake(1, { moraFrames: 9, levelDb: -62, silenceDb: -90 }),
      32,
      62,
    )
    expect(scoreTake(lineNative, quiet)).toMatchObject({
      _tag: 'CouldNotCompare',
      reason: 'TooQuiet',
    })
    for (const moraFrames of [4, 20]) {
      expect(scoreTake(lineNative, rightTake(1, { moraFrames }))).toMatchObject(
        { _tag: 'CouldNotCompare', reason: 'LengthMismatch' },
      )
    }
    for (const moraFrames of [5, 17]) {
      expect(scoreTake(lineNative, rightTake(1, { moraFrames }))._tag).toBe(
        'Scored',
      )
    }
  })

  it('weighs the parts into the match', () => {
    const score = scored(scoreTake(syntheticTake(native), rightTake(3)))
    expect(score.match).toBeCloseTo(
      0.6 * score.parts.pitchAccent + 0.4 * score.parts.timing,
      12,
    )
    expect(gainBand).toStrictEqual({ least: 0.5, most: 2 })
  })
})
