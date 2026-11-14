import { describe, expect, test } from 'vitest'

import {
  estimatePitch,
  frameSpanSeconds,
  framesReaching,
  pitchError,
} from './pitch.ts'

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

// The tone with `seconds` of silence added at `atSeconds`, as a fake
// microphone's slip adds a late device buffer's worth.
const slipped = (
  tone: Float32Array,
  atSeconds: number,
  seconds: number,
): Float32Array => {
  const at = Math.round(atSeconds * rate)
  const added = Math.round(seconds * rate)
  const result = new Float32Array(tone.length + added)
  result.set(tone.subarray(0, at))
  result.set(tone.subarray(at), at + added)
  return result
}

describe('framesReaching', () => {
  test.each([0.01, 0.02, 0.03, 0.04])(
    'bounds the frames a slip of %d s leaves with no pitch, wherever it falls',
    seconds => {
      for (let offset = 0; offset < 1 / frameHz; offset += 0.001) {
        const atSeconds = 0.5 + offset
        const samples = slipped(steadyTone(150), atSeconds, seconds)
        // Read as the fake-microphone tests read a capture across a slip:
        // each frame at the delay of its side of it.
        const before = estimatePitch(samples, rate, frameHz)
        const after = estimatePitch(samples, rate, frameHz, seconds)
        const missing = Array.from(before, (_, frame) =>
          frame / frameHz < atSeconds ? before[frame] : after[frame],
        ).flatMap((hz, frame) =>
          // Frames whose two windows lie inside the tone.
          frame >= 6 && frame <= 55 && Number.isNaN(hz) ? [frame] : [],
        )
        expect(missing.length).toBeLessThanOrEqual(
          framesReaching(seconds, frameHz),
        )
        // Each of them reads some of the silence the slip added.
        for (const frame of missing) {
          const time = frame / frameHz
          expect(time).toBeGreaterThan(atSeconds - frameSpanSeconds / 2)
          expect(time).toBeLessThan(atSeconds + seconds + frameSpanSeconds / 2)
        }
      }
    },
  )
})
