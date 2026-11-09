import { describe, expect, it } from 'vitest'

import { medianVoicedHz, semitonesFrom } from './curve'

describe('medianVoicedHz', () => {
  it('takes the median of the voiced frames only', () => {
    expect(medianVoicedHz(Float32Array.of(0, 300, 100, 0, 200))).toBe(200)
    expect(medianVoicedHz(Float32Array.of(100, 0, 200))).toBe(150)
    expect(medianVoicedHz(new Float32Array(3))).toBeNaN()
  })
})

describe('semitonesFrom', () => {
  it('counts 12 semitones to the octave', () => {
    expect(semitonesFrom(100, 200)).toBe(12)
    expect(semitonesFrom(200, 100)).toBe(-12)
    expect(semitonesFrom(100, 100 * 2 ** (1 / 12))).toBeCloseTo(1)
  })
})
