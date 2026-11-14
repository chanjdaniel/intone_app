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

  test('fits around a slip whose segment still places at the old lag, through a change of sample rate', () => {
    // As in CI's run 43223000556 (snrDb 50): 44.1 kHz, one 10 ms buffer
    // added mid-voice. Spliced 470 samples into its 882-sample segment,
    // that segment still places at the old lag, so the fit must leave out
    // the segments around a slip, not only those that did not place.
    const captureRate = 44100
    const clean = Float32Array.from(
      sourceAsCaptured(source, rate, captureRate, 0.0300589, 3 * captureRate),
    )
    const base = Math.round(0.58 * captureRate)
    for (const offset of [464, 470, 476]) {
      const capture = slipped(clean, base + offset, 441)
      const result = compareWithSource(capture, captureRate, source, rate)
      expect(result?.slips).toHaveLength(1)
      expect(result?.slips[0]?.bySeconds).toBeCloseTo(0.01, 4)
      expect(result?.snrDb).toBeGreaterThan(70)
    }
  })

  test('follows a slip of two 10 ms buffers, wider than a segment searches', () => {
    const at = Math.round(1.0113 * rate)
    const capture = slipped(delayed(source, 960, captureLength), at, 960)
    const result = compareWithSource(capture, rate, source, rate)
    expect(result?.slips).toHaveLength(1)
    expect(result?.slips[0]?.bySeconds).toBeCloseTo(0.02, 6)
    expect(result?.snrDb).toBeGreaterThan(100)
  })

  // Slips as the fake microphone made them on a loaded machine (load
  // average 22 to 32), each where it fell in a capture whose voice the
  // comparison placed 32.7 ms late, as seconds into the capture and samples
  // of silence: one buffer, several at once, and two close together.
  test.each([
    ['one buffer', [[0.7128, 480]]],
    ['two buffers', [[1.0235, 960]]],
    ['three buffers', [[1.3735, 1440]]],
    ['four buffers', [[1.4041, 1920]]],
    [
      'one buffer, then another 40 ms on',
      [
        [0.6935, 480],
        [0.7335, 480],
      ],
    ],
    [
      'one buffer, then two',
      [
        [0.8535, 480],
        [1.0235, 960],
      ],
    ],
    // Closer than a segment can place the voice between them.
    ...[0.005, 0.011, 0.02, 0.03].map(
      gap =>
        [
          `one buffer, then another ${gap * 1000} ms on`,
          [
            [1.3314, 480],
            [1.3314 + gap, 480],
          ],
        ] as const,
    ),
  ] as const)(
    'finds each slip where it falls, and fits around it: %s',
    (_, splices) => {
      const delay = Math.round(0.0327 * rate)
      const capture = splices.reduceRight(
        (slippedSoFar, [atSeconds, count]) =>
          slipped(slippedSoFar, Math.round(atSeconds * rate), count),
        delayed(source, delay, captureLength),
      )
      const result = compareWithSource(capture, rate, source, rate)
      expect(result?.delaySeconds).toBeCloseTo(delay / rate, 7)
      expect(result?.slips).toHaveLength(splices.length)
      splices.forEach(([atSeconds, count], index) => {
        const slip = result?.slips[index]
        expect(slip?.bySeconds).toBeCloseTo(count / rate, 6)
        // Found within a segment of where the source resumes.
        expect(slip?.atSeconds).toBeGreaterThanOrEqual(atSeconds)
        expect(slip?.atSeconds).toBeLessThan(atSeconds + count / rate + 0.02)
      })
      expect(result?.snrDb).toBeGreaterThan(100)
    },
  )

  test('tells two close slips from one through the device resampler, at a 16 kHz source', () => {
    // As a loaded machine's run of the 16 kHz format test fell: one 20 ms
    // slip found at 1.3514 s, 19.9 dB, a gain of 0.98999. The device plays
    // its file through 44.1 kHz, where its 10 ms buffers slip, so the
    // silence reaches the capture through a second resampler. Two buffers
    // there with 11 ms of voice between them came out, before the
    // comparison tried two splices, as one 20 ms slip at the same place, at
    // 22.7 dB and a gain of 0.995.
    const sourceRate = 16000
    const deviceRate = 44100
    const { samples: voice } = synthesiseVoice('middle', sourceRate)
    const atDevice = Float32Array.from(
      sourceAsCaptured(voice, sourceRate, deviceRate, 0.0227, 3 * deviceRate),
    )
    const first = Math.round(1.311 * deviceRate)
    const second = first + Math.round(0.011 * deviceRate)
    const onDevice = slipped(slipped(atDevice, second, 441), first, 441)
    const capture = Float32Array.from(
      sourceAsCaptured(onDevice, deviceRate, rate, 0.02, captureLength),
    )
    const result = compareWithSource(capture, rate, voice, sourceRate)
    expect(result?.delaySeconds).toBeCloseTo(0.0427, 6)
    expect(result?.slips.map(slip => slip.bySeconds)).toHaveLength(2)
    for (const slip of result?.slips ?? []) {
      expect(slip.bySeconds).toBeCloseTo(0.01, 4)
    }
    expect(result?.snrDb).toBeGreaterThan(100)
    expect(result?.gain).toBeCloseTo(1, 5)
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
