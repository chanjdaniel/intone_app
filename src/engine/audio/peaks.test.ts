import { describe, expect, test } from 'vitest'

import { peaksPerSecond, waveformPeaks } from './peaks'

describe('a waveform’s peaks', () => {
  test('one byte per 10 ms, the last bin partly filled', () => {
    expect(waveformPeaks(new Float32Array(16_000), 16_000)).toHaveLength(
      peaksPerSecond,
    )
    expect(waveformPeaks(new Float32Array(16_100), 16_000)).toHaveLength(101)
  })

  test('full scale is 255, -60 dBFS and silence 0, -24 dBFS at 0.6', () => {
    const samples = new Float32Array(640)
    samples[10] = -1
    samples[170] = 0.001
    samples[330] = 10 ** (-24 / 20)
    expect([...waveformPeaks(samples, 16_000)]).toStrictEqual([255, 0, 153, 0])
  })

  test('holds each bin’s loudest sample, whatever its sign', () => {
    const samples = Float32Array.from({ length: 160 }, (_, n) =>
      n === 80 ? -0.5 : 0.01,
    )
    expect(waveformPeaks(samples, 16_000)[0]).toBe(
      Math.round((255 * (60 + 20 * Math.log10(0.5))) / 60),
    )
  })
})
