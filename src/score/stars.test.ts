import { describe, expect, it } from 'vitest'

import { provisionalClipTop, starBeatShare, starReachShare } from './constants'
import { type StarTake, starThresholds, starsOf, starsOfTake } from './stars'

// A line's stars (report section 5): one for a guided take that reaches
// the clip's threshold, two for one that beats it, three for a blind take
// that reaches it; a take that could not be compared earns none and
// costs none.

const scored = (mode: StarTake['mode'], match: number): StarTake => ({
  mode,
  score: { _tag: 'Scored', match },
})
const couldNotCompare = (mode: StarTake['mode']): StarTake => ({
  mode,
  score: { _tag: 'CouldNotCompare' },
})

const thresholds = starThresholds()

describe('starThresholds', () => {
  it('are shares of the provisional top for every clip until one is measured', () => {
    expect(thresholds).toStrictEqual({
      reach: starReachShare * provisionalClipTop,
      beat: starBeatShare * provisionalClipTop,
    })
    expect(thresholds.reach).toBeLessThan(thresholds.beat)
  })

  it('move with the clip’s top', () => {
    expect(starThresholds(0.8)).toStrictEqual({
      reach: starReachShare * 0.8,
      beat: starBeatShare * 0.8,
    })
  })
})

describe('starsOfTake', () => {
  it('gives a guided take under the threshold none', () => {
    expect(
      starsOfTake(scored('Guided', thresholds.reach - 0.01), thresholds),
    ).toBe(0)
  })

  it('gives a guided take that reaches the threshold one', () => {
    expect(starsOfTake(scored('Guided', thresholds.reach), thresholds)).toBe(1)
    expect(
      starsOfTake(scored('Guided', thresholds.beat - 0.01), thresholds),
    ).toBe(1)
  })

  it('gives a guided take that beats the threshold two', () => {
    expect(starsOfTake(scored('Guided', thresholds.beat), thresholds)).toBe(2)
    expect(starsOfTake(scored('Guided', 1), thresholds)).toBe(2)
  })

  it('gives a blind take that reaches the threshold three, and one under it none', () => {
    expect(starsOfTake(scored('Blind', thresholds.reach), thresholds)).toBe(3)
    expect(starsOfTake(scored('Blind', 1), thresholds)).toBe(3)
    expect(
      starsOfTake(scored('Blind', thresholds.reach - 0.01), thresholds),
    ).toBe(0)
  })

  it('reads a match at the whole percent it is shown as', () => {
    expect(
      starsOfTake(scored('Guided', thresholds.reach - 0.004), thresholds),
    ).toBe(1)
    expect(
      starsOfTake(scored('Guided', thresholds.reach - 0.006), thresholds),
    ).toBe(0)
    expect(
      starsOfTake(scored('Blind', thresholds.reach - 0.004), thresholds),
    ).toBe(3)
  })

  it('gives a take that could not be compared none, guided or blind', () => {
    expect(starsOfTake(couldNotCompare('Guided'), thresholds)).toBe(0)
    expect(starsOfTake(couldNotCompare('Blind'), thresholds)).toBe(0)
  })
})

describe('starsOf', () => {
  it('is none for a line with no takes', () => {
    expect(starsOf([], thresholds)).toBe(0)
  })

  it('keeps the most any take earned, whatever came after', () => {
    expect(
      starsOf(
        [scored('Guided', 0.95), scored('Guided', 0.5), scored('Blind', 0.4)],
        thresholds,
      ),
    ).toBe(2)
    expect(
      starsOf([scored('Blind', 0.8), scored('Guided', 0.95)], thresholds),
    ).toBe(3)
  })

  it('is never lowered by a take that could not be compared', () => {
    const before = [scored('Guided', 0.8)]
    expect(starsOf(before, thresholds)).toBe(1)
    expect(
      starsOf(
        [...before, couldNotCompare('Blind'), couldNotCompare('Guided')],
        thresholds,
      ),
    ).toBe(1)
  })
})
