import { describe, expect, test } from 'vitest'

import {
  compareWithSource,
  lowPass,
  sourceAsCaptured,
} from './audio-compare.ts'
import { synthesiseVoice } from './synthetic-voice.ts'

// The comparison the fake-microphone tests measure with
// (docs/fake-microphone.md), on captures made here with known faults.

const rate = 48000
const { samples: source } = synthesiseVoice('middle', rate)

const delayed = (samples: Float32Array, by: number, length: number) => {
  const result = new Float32Array(length)
  result.set(samples.subarray(0, Math.max(0, length - by)), by)
  return result
}

// The capture with `count` samples of silence put in at `at`, or `-count`
// samples taken out there.
const slipped = (capture: Float32Array, at: number, count: number) => {
  const before = capture.subarray(0, at)
  const after = capture.subarray(count >= 0 ? at : at - count)
  const result = new Float32Array(capture.length)
  result.set(before)
  result.set(
    after.subarray(0, capture.length - at - Math.max(0, count)),
    at + Math.max(0, count),
  )
  return result
}

const captureLength = 3 * rate

describe('compareWithSource', () => {
  test('finds an unchanged capture exact, a whole number of samples late', () => {
    const capture = delayed(source, 1234, captureLength)
    expect(compareWithSource(capture, rate, source, rate)).toStrictEqual({
      delaySeconds: 1234 / rate,
      slips: [],
      gain: 1,
      snrDb: Number.POSITIVE_INFINITY,
      maxDifference: 0,
    })
  })

  test('measures a gain', () => {
    const capture = delayed(source, 480, captureLength).map(x => x * 0.5)
    const result = compareWithSource(capture, rate, source, rate)
    expect(result?.gain).toBeCloseTo(0.5, 8)
    expect(result?.delaySeconds).toBeCloseTo(480 / rate, 7)
    expect(result?.snrDb).toBeGreaterThan(100)
    expect(result?.slips).toStrictEqual([])
  })

  test('finds a fractional delay through a change of sample rate', () => {
    const captureRate = 44100
    const delaySeconds = 0.0123456
    const capture = Float32Array.from(
      sourceAsCaptured(
        source,
        rate,
        captureRate,
        delaySeconds,
        3 * captureRate,
      ),
    )
    const result = compareWithSource(capture, captureRate, source, rate)
    expect(result?.delaySeconds).toBeCloseTo(delaySeconds, 6)
    expect(result?.gain).toBeCloseTo(1, 6)
    expect(result?.snrDb).toBeGreaterThan(100)
    expect(result?.slips).toStrictEqual([])
    expect(result?.maxDifference).toBe(Number.POSITIVE_INFINITY)
  })

  test('reports 10 ms of silence put in mid-voice as a slip, and fits around it', () => {
    // Inside a segment, as a slip mostly falls.
    const at = Math.round(1.2071 * rate)
    const capture = slipped(delayed(source, 960, captureLength), at, 480)
    const result = compareWithSource(capture, rate, source, rate)
    expect(result?.delaySeconds).toBeCloseTo(960 / rate, 7)
    expect(result?.slips).toHaveLength(1)
    expect(result?.slips[0]?.atSeconds).toBeGreaterThanOrEqual(1.2)
    expect(result?.slips[0]?.atSeconds).toBeLessThan(1.25)
    expect(result?.slips[0]?.bySeconds).toBeCloseTo(0.01, 6)
    // The segment that holds the slip is left out of the fit.
    expect(result?.snrDb).toBeGreaterThan(100)
  })

  test('reports 10 ms lost as a slip back', () => {
    const at = Math.round(0.8137 * rate)
    const capture = slipped(delayed(source, 960, captureLength), at, -480)
    const result = compareWithSource(capture, rate, source, rate)
    expect(result?.slips.map(slip => slip.bySeconds)).toHaveLength(1)
    expect(result?.slips[0]?.bySeconds).toBeCloseTo(-0.01, 6)
  })

  test('follows a capture through 8-bit quantisation, and finds its slip', () => {
    const at = Math.round(1.2071 * rate)
    const capture = slipped(delayed(source, 960, captureLength), at, 480).map(
      x => Math.round(x * 128) / 128,
    )
    const result = compareWithSource(capture, rate, source, rate)
    expect(result?.gain).toBeCloseTo(1, 2)
    expect(result?.slips).toHaveLength(1)
    expect(result?.slips[0]?.bySeconds).toBeCloseTo(0.01, 6)
    expect(result?.snrDb).toBeGreaterThan(30)
  })

  test('finds a capture that lost the source start', () => {
    const lost = Math.round(0.2 * rate)
    const capture = new Float32Array(captureLength)
    capture.set(source.subarray(lost))
    const result = compareWithSource(capture, rate, source, rate)
    expect(result?.delaySeconds).toBeCloseTo(-0.2, 7)
    expect(result?.maxDifference).toBe(0)
  })

  test('fits audio changed throughout whole, at one delay', () => {
    // A crude echo, as echo cancellation's own changes are not this simple.
    const clean = delayed(source, 960, captureLength)
    const capture = clean.map(
      (x, i) => x + 0.4 * (clean[i - 1440] ?? 0) - 0.2 * (clean[i - 300] ?? 0),
    )
    const result = compareWithSource(capture, rate, source, rate)
    expect(result?.delaySeconds).toBeCloseTo(960 / rate, 4)
    expect(result?.slips).toStrictEqual([])
    expect(result?.snrDb).toBeLessThan(20)
  })

  test('compares a capture whose top band was cut, below the cut', () => {
    const capture = lowPass(delayed(source, 960, captureLength), rate, 1500)
    const whole = compareWithSource(capture, rate, source, rate)
    expect(whole?.snrDb).toBeLessThan(40)
    const below = compareWithSource(
      lowPass(capture, rate, 1200),
      rate,
      lowPass(source, rate, 1200),
      rate,
    )
    expect(below?.delaySeconds).toBeCloseTo(960 / rate, 6)
    expect(below?.gain).toBeCloseTo(1, 4)
    expect(below?.snrDb).toBeGreaterThan(60)
  })

  test('is null when nothing arrived', () => {
    expect(
      compareWithSource(new Float32Array(captureLength), rate, source, rate),
    ).toBeNull()
  })
})
