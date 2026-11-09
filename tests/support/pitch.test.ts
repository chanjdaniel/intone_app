import { describe, expect, test } from 'vitest'

import { estimatePitch, pitchError } from './pitch.ts'

// The test pitch estimate's own accuracy, which the synthetic voices'
// tests and the fake-microphone tests (docs/fake-microphone.md) allow for.

const rate = 48000
const frameHz = 62.5

// A second of a steady tone with its first five harmonics, falling in
// level, as a voice's are.
const steadyTone = (hz: number): Float32Array =>
  Float32Array.from({ length: rate }, (_, i) => {
    let sum = 0
    for (let harmonic = 1; harmonic <= 5; harmonic++) {
      sum += Math.sin((2 * Math.PI * hz * harmonic * i) / rate) / harmonic
    }
    return 0.3 * sum
  })

describe('estimatePitch', () => {
  test.each([90, 150, 220, 330])('reads a steady %d Hz within a cent', hz => {
    const estimate = estimatePitch(steadyTone(hz), rate, frameHz)
    // Frames whose two windows lie inside the second.
    const frames = Array.from({ length: 50 }, (_, i) => i + 6)
    const error = pitchError(
      estimate,
      Array.from(estimate, () => hz),
      frames,
    )
    expect(error.missing).toBe(0)
    expect(error.maxCents).toBeLessThan(1)
  })

  test('reads silence as no pitch', () => {
    const estimate = estimatePitch(new Float32Array(rate), rate, frameHz)
    expect(estimate.every(Number.isNaN)).toBe(true)
  })
})
