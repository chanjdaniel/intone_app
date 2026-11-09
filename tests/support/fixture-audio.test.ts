import { describe, expect, test } from 'vitest'

import { mixNoise, phoneBand, rmsOf, toMono } from './fixture-audio.ts'
import { random } from './random.ts'

const sampleRate = 24000

const tone = (hz: number, seconds = 1): Float32Array =>
  Float32Array.from(
    { length: seconds * sampleRate },
    (_, n) => 0.5 * Math.sin((2 * Math.PI * hz * n) / sampleRate),
  )

// The gain at a tone's frequency, in dB, read past the filter's settling.
const gainDb = (hz: number): number => {
  const input = tone(hz)
  const output = phoneBand(input, sampleRate)
  const settled = [{ from: sampleRate / 2, to: input.length }]
  return 20 * Math.log10(rmsOf(output, settled) / rmsOf(input, settled))
}

const noiseOf = (length: number, seed: number): Float32Array => {
  const next = random(seed)
  return Float32Array.from({ length }, () => 0.1 * (2 * next() - 1))
}

describe('the phone-like band filter', () => {
  test.each([500, 1000, 2000, 2500])('passes %d Hz within 1 dB', hz => {
    expect(Math.abs(gainDb(hz))).toBeLessThan(1)
  })

  test.each([300, 3400])('is 3 dB down at its %d Hz edge', hz => {
    expect(gainDb(hz)).toBeCloseTo(-3, 0)
  })

  test('cuts a low voice under the band and the air above it', () => {
    expect(gainDb(100)).toBeLessThan(-35)
    expect(gainDb(8000)).toBeLessThan(-30)
  })

  test('keeps the length and leaves its input alone', () => {
    const input = tone(1000)
    const copy = input.slice()
    expect(phoneBand(input, sampleRate)).toHaveLength(input.length)
    expect(input).toStrictEqual(copy)
  })
})

describe('mixing in room noise', () => {
  const speech = tone(220, 2)
  const spans = [{ from: 12000, to: 36000 }]
  const noise = noiseOf(5 * sampleRate, 7)

  test('puts the noise at the asked level under the speech', () => {
    const { samples, noiseGain } = mixNoise(speech, noise, {
      snrDb: 20,
      offset: 1000,
      speechSpans: spans,
    })
    const added = samples.map((sample, n) => sample - (speech[n] ?? 0))
    const snr = 20 * Math.log10(rmsOf(speech, spans) / rmsOf(added, spans))
    expect(snr).toBeCloseTo(20, 2)
    expect(noiseGain).toBeGreaterThan(0)
  })

  test('takes the noise from its offset, over the whole file', () => {
    const { samples, noiseGain } = mixNoise(speech, noise, {
      snrDb: 20,
      offset: 1000,
      speechSpans: spans,
    })
    expect(samples).toHaveLength(speech.length)
    expect(samples[0]).toBeCloseTo(
      (speech[0] ?? 0) + noiseGain * (noise[1000] ?? 0),
      6,
    )
    expect(samples[speech.length - 1]).toBeCloseTo(
      (speech[speech.length - 1] ?? 0) +
        noiseGain * (noise[1000 + speech.length - 1] ?? 0),
      6,
    )
  })

  test('refuses noise too short for the file', () => {
    expect(() =>
      mixNoise(speech, noise, {
        snrDb: 20,
        offset: noise.length - 10,
        speechSpans: spans,
      }),
    ).toThrow(/too short/)
  })
})

describe('mixing to mono', () => {
  test('averages the channels', () => {
    const left = Float32Array.of(1, 0.5, 0)
    const right = Float32Array.of(0, 0.5, -1)
    expect(toMono([left, right])).toStrictEqual(Float32Array.of(0.5, 0.5, -0.5))
  })
})
