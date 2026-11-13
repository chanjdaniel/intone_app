import { describe, expect, it } from 'vitest'

import {
  type Aligner,
  dtwAligner,
  normaliseFeatures,
  stretchAligner,
  withFallback,
} from './align'
import type { Features } from './features'
import { featureDims, syntheticTake } from './synthetic-take'

const dtw = dtwAligner({
  bandShare: 0.2,
  bandSeconds: 0.25,
  failDistance: Number.POSITIVE_INFINITY,
})

const line = [true, false, false, true, false, true]
const recording = (moraFrames: ReadonlyArray<number>, seed: number) =>
  syntheticTake({
    pattern: line,
    moraFrames,
    registerHz: 200,
    spanSemitones: 5,
    seed,
    leadFrames: 0,
    tailFrames: 0,
    colour: seed,
  }).features
const whole = (features: Features) =>
  normaliseFeatures(features, 0, features.data.length / features.dims)

// Each native mora's first frame, and where the path puts it in the take.
const moraStarts = (lengths: ReadonlyArray<number>) =>
  lengths.map((_, k) => lengths.slice(0, k).reduce((a, b) => a + b, 0))

describe('normaliseFeatures', () => {
  it('takes each dimension to mean 0 and variance 1 over the frames asked', () => {
    const features = recording([10, 10, 10, 10, 10, 10], 3)
    const normal = normaliseFeatures(features, 5, 45)
    expect(normal.data.length).toBe(40 * featureDims)
    for (let d = 0; d < featureDims; d++) {
      let sum = 0
      let squares = 0
      for (let f = 0; f < 40; f++) {
        const value = normal.data[f * featureDims + d] ?? 0
        sum += value
        squares += value * value
      }
      expect(sum / 40).toBeCloseTo(0, 5)
      expect(squares / 40).toBeCloseTo(1, 4)
    }
  })

  it('takes a microphone’s or a voice’s colour out', () => {
    const features = recording([10, 10, 10, 10, 10, 10], 0)
    const coloured: Features = {
      ...features,
      data: features.data.map((value, i) => 3 * value + (i % featureDims)),
    }
    const a = whole(features).data
    const b = whole(coloured).data
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toBeCloseTo(a[i] ?? 0, 4)
    }
  })
})

describe('stretchAligner', () => {
  it('pairs the frames evenly, end to end', () => {
    const path = stretchAligner.align(
      whole(recording([5, 5, 5, 5, 5, 5], 1)),
      whole(recording([10, 10, 10, 10, 10, 10], 2)),
    )
    expect(path?.native[0]).toBe(0)
    expect(path?.take[0]).toBe(0)
    expect(path?.native.at(-1)).toBe(29)
    expect(path?.take.at(-1)).toBe(59)
    expect(path?.take[30]).toBe(30)
    expect(path?.native[30]).toBe(15)
  })
})

describe('dtwAligner', () => {
  it('finds each mora in a take that holds some and rushes others', () => {
    const native = [10, 10, 10, 10, 10, 10]
    const take = [10, 18, 6, 10, 15, 8]
    const path = dtw.align(
      whole(recording(native, 1)),
      whole(recording(take, 2)),
    )
    if (path === null) throw new Error('no path')
    const starts = moraStarts(native)
    const takeStarts = moraStarts(take)
    starts.forEach((start, k) => {
      const paired = Array.from(path.native).indexOf(start)
      expect(
        Math.abs((path.take[paired] ?? 0) - (takeStarts[k] ?? 0)),
        `mora ${k}`,
      ).toBeLessThanOrEqual(1)
    })
  })

  it('steps forward from the first frames to the last, never back', () => {
    const path = dtw.align(
      whole(recording([8, 12, 9, 10, 11, 9], 4)),
      whole(recording([12, 9, 14, 8, 10, 12], 5)),
    )
    if (path === null) throw new Error('no path')
    expect([path.native[0], path.take[0]]).toStrictEqual([0, 0])
    expect([path.native.at(-1), path.take.at(-1)]).toStrictEqual([58, 64])
    for (let k = 1; k < path.native.length; k++) {
      const di = (path.native[k] ?? 0) - (path.native[k - 1] ?? 0)
      const dj = (path.take[k] ?? 0) - (path.take[k - 1] ?? 0)
      expect([0, 1]).toContain(di)
      expect([0, 1]).toContain(dj)
      expect(di + dj).toBeGreaterThan(0)
    }
  })

  it('answers null for features that cannot be lined up', () => {
    const native = whole(recording([10, 10, 10, 10, 10, 10], 1))
    const other: Features = {
      frameHz: 62.5,
      dims: 3,
      data: new Float32Array(30),
    }
    expect(dtw.align(native, other)).toBeNull()
    expect(dtw.align(native, { ...native, frameHz: 100 })).toBeNull()
    expect(
      dtw.align(native, {
        ...native,
        data: native.data.subarray(0, featureDims),
      }),
    ).toBeNull()
  })

  it('answers null when its path matched nothing, past the failure gate', () => {
    const gated = dtwAligner({
      bandShare: 0.2,
      bandSeconds: 0.25,
      failDistance: 2,
    })
    const native = whole(recording([10, 10, 10, 10, 10, 10], 1))
    const same = whole(recording([11, 9, 10, 12, 9, 10], 2))
    const next = (() => {
      let state = 7
      return () => {
        state = (state * 1103515245 + 12345) % 2147483648
        return state / 2147483648 - 0.5
      }
    })()
    const noise: Features = {
      ...native,
      data: native.data.map(() => next()),
    }
    expect(gated.align(native, same)).not.toBeNull()
    expect(gated.align(native, whole(noise))).toBeNull()
  })
})

describe('withFallback', () => {
  it('takes the fallback’s path where the first aligner fails', () => {
    const failing: Aligner = { name: 'failing', align: () => null }
    const aligner = withFallback(failing, stretchAligner)
    const native = whole(recording([5, 5, 5, 5, 5, 5], 1))
    const take = whole(recording([6, 6, 6, 6, 6, 6], 2))
    expect(aligner.align(native, take)).toStrictEqual(
      stretchAligner.align(native, take),
    )
    expect(withFallback(dtw, stretchAligner).align(native, take)).toStrictEqual(
      dtw.align(native, take),
    )
  })
})
