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

// Said `factor` times as slowly, from the same onset.
const slowed = (curve: TakeCurve, factor: number): TakeCurve => {
  const frames = Math.round(curve.f0Hz.length * factor)
  const at = (values: ReadonlyArray<number>) =>
    Array.makeBy(frames, frame => {
      const source = curve.onsetFrame + (frame - curve.onsetFrame) / factor
      return frame < curve.onsetFrame
        ? (values[frame] ?? 0)
        : (values[Math.round(source)] ?? 0)
    })
  return {
    ...curve,
    f0Hz: at(curve.f0Hz),
    confidence: at(curve.confidence),
    levelDb: at(curve.levelDb),
  }
}

export const sampleTakes: Readonly<Record<SampleTakeName, TakeCurve>> = {
  low: sampleCurves.low,
  high: sampleCurves.high,
  flattened: flattened(sampleCurves.middle, 0.3),
  slower: slowed(sampleCurves.middle, 1.15),
  'much-slower': slowed(sampleCurves.middle, 1.6),
}
