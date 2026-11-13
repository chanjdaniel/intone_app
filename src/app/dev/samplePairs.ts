import { Array } from 'effect'

import type { TakeCurve } from '../take/take'
import { sampleCurves } from './sampleCurves'

// Takes to draw over a line in the library, derived from the synthetic
// voices' generated labels, never typed in: the middle voice is the line,
// and each take is a voice copying it the same, or flatter, or slower.

export const sampleLine: TakeCurve = sampleCurves.middle

export const sampleTakeNames = [
  'low',
  'high',
  'flattened',
  'slower',
  'much-slower',
] as const
export type SampleTakeName = (typeof sampleTakeNames)[number]

export const sampleTakeLabel: Readonly<Record<SampleTakeName, string>> = {
  low: 'Same shape, low voice',
  high: 'Same shape, high voice',
  flattened: 'Flattened',
  slower: 'Slower',
  'much-slower': 'Much slower',
}

// Its rises and falls at `fraction` of their size, around its median.
const flattened = (curve: TakeCurve, fraction: number): TakeCurve => {
  const voiced = Array.filter(curve.f0Hz, hz => hz > 0)
  const sorted = Array.sort(voiced, (a: number, b: number) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  const median = sorted[sorted.length >> 1] ?? 1
  return {
    ...curve,
    f0Hz: Array.map(curve.f0Hz, hz =>
      hz > 0 ? median * (hz / median) ** fraction : 0,
    ),
  }
}

// Said `factor` times as slowly, from the same onset: each frame read
// between the two it falls between, and unvoiced where either is.
const slowed = (curve: TakeCurve, factor: number): TakeCurve => {
  const frames = Math.round(curve.f0Hz.length * factor)
  const sourceOf = (frame: number): number =>
    frame < curve.onsetFrame
      ? frame
      : curve.onsetFrame + (frame - curve.onsetFrame) / factor
  const between = (values: ReadonlyArray<number>, source: number): number => {
    const before = values[Math.floor(source)] ?? 0
    const after = values[Math.ceil(source)] ?? 0
    return before + (after - before) * (source - Math.floor(source))
  }
  const voicedAt = (source: number): boolean =>
    (curve.f0Hz[Math.floor(source)] ?? 0) > 0 &&
    (curve.f0Hz[Math.ceil(source)] ?? 0) > 0
  return {
    ...curve,
    f0Hz: Array.makeBy(frames, frame =>
      voicedAt(sourceOf(frame)) ? between(curve.f0Hz, sourceOf(frame)) : 0,
    ),
    confidence: Array.makeBy(frames, frame =>
      between(curve.confidence, sourceOf(frame)),
    ),
    levelDb: Array.makeBy(frames, frame =>
      between(curve.levelDb, sourceOf(frame)),
    ),
  }
}

export const sampleTakes: Readonly<Record<SampleTakeName, TakeCurve>> = {
  low: sampleCurves.low,
  high: sampleCurves.high,
  flattened: flattened(sampleCurves.middle, 0.3),
  slower: slowed(sampleCurves.middle, 1.15),
  'much-slower': slowed(sampleCurves.middle, 1.6),
}
