import { describe, expect, it } from 'vitest'

import {
  type SwiftF0Inference,
  frameCount,
  swiftF0Hop,
  swiftF0MaxHz,
  swiftF0MinHz,
  trackFrames,
} from './swift-f0'

// A stand-in for the model that reads each frame's own hop only: its
// "pitch" is the hop's mean times 1000 and its confidence 0.9. Its
// answer for a frame is the same in any window, as the real model's is
// once the window holds enough context, so stitched windows must equal
// one run over everything.
const hopMeans: SwiftF0Inference = async samples => {
  const frames = frameCount(samples.length)
  const pitchHz = Float64Array.from({ length: frames }, (_, frame) => {
    const hop = samples.subarray(frame * swiftF0Hop, (frame + 1) * swiftF0Hop)
    return (1000 * hop.reduce((sum, x) => sum + x, 0)) / hop.length
  })
  return { pitchHz, confidence: new Float32Array(frames).fill(0.9) }
}

// A ramp from 0.01 to 0.5, so each hop's mean names where it is.
const ramp = (length: number): Float32Array =>
  Float32Array.from({ length }, (_, i) => 0.01 + (0.49 * i) / length)

describe('trackFrames', () => {
  it('gives one frame per 256 samples, at least one', async () => {
    expect((await trackFrames(ramp(16_000), hopMeans)).pitchHz.length).toBe(62)
    expect((await trackFrames(ramp(100), hopMeans)).pitchHz.length).toBe(1)
    await expect(trackFrames(new Float32Array(0), hopMeans)).rejects.toThrow(
      RangeError,
    )
  })

  it('runs a long take in windows with context either side, stitched as one run', async () => {
    // 70 s: three windows of 1,875 frames, the last short.
    const samples = ramp(70 * 16_000)
    const calls: Array<
      Readonly<{ length: number; minHz: number; maxHz: number }>
    > = []
    const recording: SwiftF0Inference = async (window, minHz, maxHz) => {
      calls.push({ length: window.length, minHz, maxHz })
      return hopMeans(window, minHz, maxHz)
    }
    const stitched = await trackFrames(samples, recording)
    const whole = await hopMeans(samples, swiftF0MinHz, swiftF0MaxHz)

    expect(calls).toStrictEqual([
      { length: (1875 + 10) * 256, minHz: 46.875, maxHz: 2093.75 },
      { length: (11 + 1875 + 10) * 256, minHz: 46.875, maxHz: 2093.75 },
      {
        length: samples.length - (2 * 1875 - 11) * 256,
        minHz: 46.875,
        maxHz: 2093.75,
      },
    ])
    expect(stitched.pitchHz.length).toBe(4375)
    stitched.pitchHz.forEach((hz, frame) => {
      expect(hz).toBeCloseTo(whole.pitchHz[frame] ?? Number.NaN, 2)
    })
  })

  it('gives digital silence no confidence, whatever the model says', async () => {
    const samples = ramp(256 * 4)
    samples.fill(0.0005, 256, 512)
    const { confidence } = await trackFrames(samples, hopMeans)
    expect(Array.from(confidence)).toStrictEqual([
      Math.fround(0.9),
      0,
      Math.fround(0.9),
      Math.fround(0.9),
    ])
  })

  it('measures each frame over the 32 ms centred on it', async () => {
    const samples = new Float32Array(256 * 3)
    samples.fill(0.5, 256, 512)
    const { levelDb } = await trackFrames(samples, hopMeans)
    // Frame 1 is centred on sample 256: half its window is 0.5, half 0.
    expect(levelDb[0]).toBeCloseTo(-140, 3)
    expect(levelDb[1]).toBeCloseTo(20 * Math.log10(0.5 * Math.SQRT1_2), 3)
    expect(levelDb[2]).toBeCloseTo(20 * Math.log10(0.5 * Math.SQRT1_2), 3)
  })
})
