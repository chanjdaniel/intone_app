import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { alignedTakeF0 } from './align'
import {
  SCORE_VERSION,
  gainBand,
  pitchSkillTop,
  worstStretchSeconds,
} from './constants'
import { type ScoredTake, scoreDetail, scoreTake } from './score'
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
// The pitch accent part is the raw pitch skill over the scale's top
// (`pitchSkillTop`, 0.67), so a tolerance on the skill is half again as
// wide on the part.
const onPart = (skillTolerance: number) => skillTolerance / pitchSkillTop

const scored = ({ score }: ScoredTake) => {
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
    ).score
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

  it('stops ignoring span outside the gain band', () => {
    const take = rightTake(1)
    const before = scored(scoreTake(syntheticTake(native), take))
    const timid = withF0(take, hz => 130 * (hz / 130) ** 0.2)
    const after = scored(scoreTake(syntheticTake(native), timid))
    expect(after.parts.pitchAccent).toBeLessThan(before.parts.pitchAccent - 0.3)
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

  it('never counts missing pitch as an error', () => {
    // A perfect copy sits above the scale's top, where the Score's part
    // reads 1 whatever a gap costs, so this reads the raw skill through
    // the study's reader (docs/score.md, "Gaps").
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
    expect(scoreTake(lineNative, sparse).score).toMatchObject({
      _tag: 'CouldNotCompare',
      reason: 'TooLittleVoiced',
    })
    const quiet = withGap(
      rightTake(1, { moraFrames: 9, levelDb: -62, silenceDb: -90 }),
      32,
      62,
    )
    expect(scoreTake(lineNative, quiet).score).toMatchObject({
      _tag: 'CouldNotCompare',
      reason: 'TooQuiet',
    })
    for (const moraFrames of [4, 20]) {
      expect(
        scoreTake(lineNative, rightTake(1, { moraFrames })).score,
      ).toMatchObject({ _tag: 'CouldNotCompare', reason: 'LengthMismatch' })
    }
    for (const moraFrames of [5, 17]) {
      expect(
        scoreTake(lineNative, rightTake(1, { moraFrames })).score._tag,
      ).toBe('Scored')
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

// The spec's properties (spec, "Testing Decisions") on drawn curves: a
// native line in a Tokyo accent pattern, and a take of it in another voice,
// each drawn by fast-check, which prints the seed and the curves that
// broke a property so a failure can be run again.

// A Tokyo accent pattern of `morae`, high or low per mora: with the accent
// on mora `kernel` (0 for none), atamadaka starts high and falls, any other
// rises from the first mora and falls after its kernel.
const accentPattern = (morae: number, kernel: number): Array<boolean> =>
  Array.from({ length: morae }, (_, k) =>
    kernel === 1 ? k === 0 : k > 0 && (kernel === 0 || k < kernel),
  )

const drawnLine = fc
  .integer({ min: 2, max: 8 })
  .chain(morae =>
    fc.record({
      pattern: fc
        .integer({ min: 0, max: morae })
        .map(kernel => accentPattern(morae, kernel)),
      registerHz: fc.integer({ min: 150, max: 300 }),
      spanSemitones: fc.integer({ min: 3, max: 8 }),
      seed: fc.integer({ min: 1, max: 1_000_000 }),
    }),
  )
  .map((line): SyntheticTake => ({ ...line, moraFrames: 9 }))

// A take of `line` in another voice: its own register, mora lengths,
// colour, noise and jitter.
const drawnTake = (line: SyntheticTake, jitter = { max: 1 }) =>
  fc
    .record({
      registerHz: fc.integer({ min: 90, max: 300 }),
      moraFrames: fc.array(fc.integer({ min: 7, max: 12 }), {
        minLength: line.pattern.length,
        maxLength: line.pattern.length,
      }),
      seed: fc.integer({ min: 1, max: 1_000_000 }),
      colour: fc.double({ min: 0.5, max: 2, noNaN: true }),
      jitter: fc.double({ min: 0, max: jitter.max, noNaN: true }),
    })
    .map((voice): SyntheticTake => ({
      ...voice,
      pattern: line.pattern,
      spanSemitones: line.spanSemitones,
    }))

const lineAndTake = (jitter?: { max: number }) =>
  drawnLine.chain(line => drawnTake(line, jitter).map(take => ({ line, take })))

// Each property runs the same 60 draws every time, from its own seed, so
// CI never draws a new worst case; fast-check prints the seed and the
// draw on a failure. The bounds are the worst of 5,000 draws each, with a
// margin (docs/score.md, "What drawn curves found"), not the score's aim:
// ticket 22 starts from them.
const runs = (seed: number) => ({ numRuns: 60, seed })

// A flat take's pitch accent part, at most: 0.105 seen, on two morae.
const flatTop = 0.12
// The octave jumps' move of the raw skill, at most: 0.31 seen, on two morae.
const octaveSkillTop = 0.33
// A take said evenly slower or faster: its timing part at least, and how
// far from the steady take's at most, by the line's morae (2 to 8). Short
// lines are barely longer than the 0.2 s timing window.
const timingFloor = [0, 0, 0.15, 0.6, 0.75, 0.85, 0.85, 0.85, 0.9]
const timingDrift = [1, 1, 0.85, 0.4, 0.22, 0.13, 0.13, 0.13, 0.06]

describe('the score’s properties, on drawn curves', () => {
  it('leaves the score unchanged when the take’s register shifts', () => {
    fc.assert(
      fc.property(
        lineAndTake(),
        fc.integer({ min: -14, max: 14 }),
        ({ line, take }, semitones) => {
          const native = syntheticTake(line)
          const said = syntheticTake(take)
          const before = scoreTake(native, said).score
          const after = scoreTake(
            native,
            withF0(said, hz => hz * 2 ** (semitones / 12)),
          ).score
          expect(after._tag).toBe(before._tag)
          if (before._tag === 'Scored' && after._tag === 'Scored') {
            // The curve holds float32 Hz, so a shift rounds each frame
            // anew.
            expect(
              Math.abs(after.parts.pitchAccent - before.parts.pitchAccent),
            ).toBeLessThan(onPart(1e-6))
            expect(after.parts.timing).toBe(before.parts.timing)
          }
        },
      ),
      runs(1001),
    )
  })

  it('leaves the score within 0.01 of the skill when the take’s span scales inside the gain band', () => {
    fc.assert(
      fc.property(
        lineAndTake({ max: 2 }),
        fc.double({ min: 0.6, max: 1.6, noNaN: true }),
        ({ line, take }, span) => {
          const native = syntheticTake(line)
          const said = syntheticTake(take)
          // The gain the take needs once scaled stays inside the band,
          // with room for the scaled take's own fit.
          const { gain } = scoreDetail(native, said)
          fc.pre(
            Number.isFinite(gain) &&
              gain / span >= gainBand.least * 1.1 &&
              gain / span <= gainBand.most / 1.1,
          )
          const before = scored(scoreTake(native, said))
          // The take's movement scaled around its own register.
          const scaled = withF0(
            said,
            hz => take.registerHz * (hz / take.registerHz) ** span,
          )
          const after = scored(scoreTake(native, scaled))
          expect(
            Math.abs(after.parts.pitchAccent - before.parts.pitchAccent),
          ).toBeLessThan(onPart(0.01))
        },
      ),
      runs(1002),
    )
  })

  it('scores a flat take near zero at any length, under the measured bound', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 60 }).chain(morae =>
          fc.record({
            pattern: fc
              .integer({ min: 0, max: morae })
              .map(kernel => accentPattern(morae, kernel)),
            seed: fc.integer({ min: 1, max: 1_000_000 }),
            registerHz: fc.integer({ min: 90, max: 300 }),
          }),
        ),
        ({ pattern, seed, registerHz }) => {
          const lineNative = syntheticTake({ ...native, pattern })
          const flat = syntheticTake({
            ...native,
            pattern,
            registerHz,
            spanSemitones: 0,
            seed,
            colour: 1,
          })
          expect(
            scored(scoreTake(lineNative, flat)).parts.pitchAccent,
          ).toBeLessThan(flatTop)
        },
      ),
      runs(1003),
    )
  })

  it('keeps the timing part of a take said uniformly slower or faster, within the measured bounds for its length', () => {
    fc.assert(
      fc.property(
        lineAndTake(),
        fc.integer({ min: 6, max: 17 }),
        ({ line, take }, frames) => {
          const native = syntheticTake(line)
          const steady = scored(
            scoreTake(native, syntheticTake({ ...take, moraFrames: 9 })),
          )
          const paced = scored(
            scoreTake(native, syntheticTake({ ...take, moraFrames: frames })),
          )
          const morae = line.pattern.length
          expect(paced.parts.timing).toBeGreaterThan(timingFloor[morae] ?? 1)
          expect(
            Math.abs(paced.parts.timing - steady.parts.timing),
          ).toBeLessThan(timingDrift[morae] ?? 0)
        },
      ),
      runs(1004),
    )
  })

  it('moves the pitch accent part by under the measured bound for octave jumps in one frame in 20', () => {
    fc.assert(
      fc.property(lineAndTake({ max: 2 }), ({ line, take }) => {
        const native = syntheticTake(line)
        const said = syntheticTake(take)
        const before = scoreTake(native, said).score
        let voiced = 0
        const jumped = withF0(said, hz => {
          voiced++
          return voiced % 20 === 0 ? hz * (voiced % 40 === 0 ? 2 : 0.5) : hz
        })
        const after = scoreTake(native, jumped).score
        expect(after._tag).toBe(before._tag)
        if (before._tag === 'Scored' && after._tag === 'Scored') {
          expect(
            Math.abs(after.parts.pitchAccent - before.parts.pitchAccent),
          ).toBeLessThan(onPart(octaveSkillTop))
        }
      }),
      runs(1005),
    )
  })
})

describe('scoreTake’s alignment', () => {
  it('gives the score and the path that lined the take up, in each curve’s own frames', () => {
    const lineNative = syntheticTake(native)
    for (const seed of seeds) {
      const take = rightTake(seed, { leadFrames: 30 })
      const { score, alignment } = scoreTake(lineNative, take)
      expect(score._tag).toBe('Scored')
      if (alignment === null) {
        throw new Error('no alignment')
      }
      const pairs = alignment.native.length
      expect(alignment.take.length).toBe(pairs)
      for (let k = 1; k < pairs; k++) {
        expect(alignment.native[k] ?? 0).toBeGreaterThanOrEqual(
          alignment.native[k - 1] ?? 0,
        )
        expect(alignment.take[k] ?? 0).toBeGreaterThanOrEqual(
          alignment.take[k - 1] ?? 0,
        )
      }
      // From the start of each one's speech to its end: the native's
      // lead is 20 frames, the take's 30.
      expect(alignment.native[0]).toBe(20)
      expect(alignment.take[0]).toBe(30)
      expect(alignment.native[pairs - 1]).toBe(20 + 45 - 1)
      expect(alignment.take[pairs - 1]).toBe(take.curve.f0Hz.length - 20 - 1)
    }
  })

  it('has no path when it cannot compare', () => {
    const refused = scoreTake(
      syntheticTake(native),
      rightTake(1, { moraFrames: 30 }),
    )
    expect(refused.score._tag).toBe('CouldNotCompare')
    expect(refused.alignment).toBeNull()
  })
})

describe('alignedTakeF0', () => {
  it('draws a take said more slowly at the native’s own frames', () => {
    const lineNative = syntheticTake(native)
    // The same voice and accent, each mora half again as long.
    const slower = syntheticTake({ ...native, moraFrames: 14, seed: 7 })
    const { alignment } = scoreTake(lineNative, slower)
    if (alignment === null) {
      throw new Error('no alignment')
    }
    const aligned = alignedTakeF0(
      alignment,
      slower.curve.f0Hz,
      lineNative.curve.f0Hz.length,
    )
    expect(aligned.length).toBe(lineNative.curve.f0Hz.length)
    // Unpaired frames, before and after the speech, stay unvoiced.
    expect(Array.from(aligned.slice(0, 20)).every(hz => hz === 0)).toBe(true)
    expect(Array.from(aligned.slice(65)).every(hz => hz === 0)).toBe(true)
    // Each speech frame within a semitone of the native's.
    const misses = Array.from(aligned.slice(20, 65)).filter(
      (hz, i) =>
        Math.abs(12 * Math.log2(hz / (lineNative.curve.f0Hz[20 + i] ?? 1))) > 1,
    )
    expect(misses.length).toBeLessThan(4)
  })

  it('reads each native frame from the voiced take frames paired with it, unvoiced when none is', () => {
    const alignment = {
      native: Int32Array.of(0, 1, 1, 2, 3, 3),
      take: Int32Array.of(0, 1, 2, 3, 4, 5),
    }
    const aligned = alignedTakeF0(
      alignment,
      Float32Array.of(100, 200, 800, 0, 0, 300),
      5,
    )
    // Frame 1 pairs with 200 and 800 Hz: their mean in octaves, 400.
    expect(Array.from(aligned)).toStrictEqual([100, 400, 0, 300, 0])
  })
})
