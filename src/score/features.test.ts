import { describe, expect, it } from 'vitest'

import { dtwAligner, normaliseFeatures } from './align'
import { type Features, featureFrames, onCurveFrames } from './features'

// A speech model's frames, 50 a second with the first centred 12.5 ms in
// (WavLM's), put on the curve's 62.5 frames a second.
const modelFrames = (
  frames: number,
  value: (frame: number, dim: number) => number,
  dims = 2,
): Features => ({
  frameHz: 50,
  dims,
  data: Float32Array.from({ length: frames * dims }, (_, at) =>
    value(Math.floor(at / dims), at % dims),
  ),
})

describe('onCurveFrames', () => {
  it('gives as many frames as asked, at the rate asked', () => {
    const features = onCurveFrames(
      modelFrames(10, () => 1),
      0.0125,
      62.5,
      13,
    )
    expect(features.frameHz).toBe(62.5)
    expect(features.dims).toBe(2)
    expect(featureFrames(features)).toBe(13)
  })

  it('reads a line straight between the model frames either side', () => {
    // Each dim rises 1 a model frame: at a curve frame's time t it reads
    // (t - 0.0125) x 50, and dim 1 is dim 0 doubled.
    const features = onCurveFrames(
      modelFrames(50, (frame, dim) => frame * (dim + 1)),
      0.0125,
      62.5,
      60,
    )
    for (let f = 1; f < 60; f++) {
      const expected = (f / 62.5 - 0.0125) * 50
      expect(features.data[f * 2]).toBeCloseTo(expected, 4)
      expect(features.data[f * 2 + 1]).toBeCloseTo(2 * expected, 4)
    }
  })

  it('holds the first and last model frames past either end', () => {
    const features = onCurveFrames(
      modelFrames(4, frame => frame),
      0.0125,
      62.5,
      20,
    )
    expect(features.data[0]).toBe(0)
    expect(features.data[19 * 2]).toBe(3)
  })

  it('lets the score aligner line up a slower copy by the model frames', () => {
    // A sound that keeps changing, a direction in two dims turning
    // unevenly, so each frame has one match; the take says the same at
    // half the speed.
    const sound = (frame: number, length: number, dim: number) => {
      const angle = Math.PI * (frame / length) ** 1.5
      return dim === 0 ? Math.cos(angle) : Math.sin(angle)
    }
    const native = onCurveFrames(
      modelFrames(30, (frame, dim) => sound(frame, 30, dim)),
      0.0125,
      62.5,
      37,
    )
    const take = onCurveFrames(
      modelFrames(60, (frame, dim) => sound(frame, 60, dim)),
      0.0125,
      62.5,
      75,
    )
    const aligner = dtwAligner({
      bandShare: 0.2,
      bandSeconds: 0.25,
      failDistance: Number.POSITIVE_INFINITY,
    })
    const path = aligner.align(
      normaliseFeatures(native, 0, 37),
      normaliseFeatures(take, 0, 75),
    )
    expect(path).not.toBeNull()
    // The native's middle frame pairs with the take's middle.
    const middle = Array.from(path?.native ?? []).indexOf(18)
    expect(Math.abs((path?.take[middle] ?? 0) - 37)).toBeLessThanOrEqual(3)
  })
})
