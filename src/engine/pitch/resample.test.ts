import { describe, expect, it } from 'vitest'

import { createResampler, resample } from './resample'

const tone = (
  rate: number,
  hz: number,
  seconds: number,
  amplitude = 0.5,
): Float32Array =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate),
  )

// The RMS of the samples away from the edges, where the kernel reads the
// silence before and after the recording.
const innerRms = (samples: Float32Array, edge: number): number => {
  const inner = samples.subarray(edge, samples.length - edge)
  return Math.sqrt(inner.reduce((sum, x) => sum + x * x, 0) / inner.length)
}

const largestError = (
  actual: Float32Array,
  expected: Float32Array,
  edge: number,
): number => {
  let largest = 0
  for (let i = edge; i < actual.length - edge; i++) {
    largest = Math.max(largest, Math.abs((actual[i] ?? 0) - (expected[i] ?? 0)))
  }
  return largest
}

describe('resample', () => {
  it.each([48_000, 44_100, 96_000, 22_050])(
    'keeps a 220 Hz tone from %i Hz to 16 kHz, in level and in time',
    rate => {
      const output = resample(tone(rate, 220, 1), rate, 16_000)
      expect(output.length).toBe(16_000)
      expect(largestError(output, tone(16_000, 220, 1), 400)).toBeLessThan(1e-3)
    },
  )

  it('passes speech up to 6.5 kHz', () => {
    const output = resample(tone(48_000, 6_500, 1), 48_000, 16_000)
    expect(innerRms(output, 400) / (0.5 / Math.SQRT2)).toBeGreaterThan(0.98)
  })

  it.each([9_000, 12_000, 20_000])(
    'removes a %i Hz tone rather than folding it below 8 kHz',
    hz => {
      const output = resample(tone(48_000, hz, 1), 48_000, 16_000)
      const levelDb =
        20 * Math.log10(innerRms(output, 400) / (0.5 / Math.SQRT2))
      expect(levelDb).toBeLessThan(-60)
    },
  )

  it('gives the same output however the input is split into batches', () => {
    const input = tone(48_000, 330, 0.5)
    const whole = resample(input, 48_000, 16_000)
    const resampler = createResampler(48_000, 16_000)
    const parts: Array<Float32Array> = []
    for (let start = 0; start < input.length; start += 960) {
      parts.push(resampler.push(input.subarray(start, start + 960)))
    }
    parts.push(resampler.flush())
    const joined = Float32Array.from(parts.flatMap(part => Array.from(part)))
    expect(joined.length).toBe(whole.length)
    expect(largestError(joined, whole, 0)).toBeLessThan(1e-6)
  })

  it('holds back only the outputs whose kernel waits for later input', () => {
    const resampler = createResampler(48_000, 16_000)
    const first = resampler.push(new Float32Array(960))
    expect(first.length).toBeGreaterThan(260)
    expect(first.length).toBeLessThan(320)
    expect(first.length + resampler.flush().length).toBe(320)
  })

  it('copies at an equal rate and refuses to raise one', () => {
    const input = Float32Array.of(0.1, 0.2, 0.3)
    expect(Array.from(resample(input, 16_000, 16_000))).toStrictEqual(
      Array.from(input),
    )
    expect(() => createResampler(16_000, 48_000)).toThrow(RangeError)
  })
})
