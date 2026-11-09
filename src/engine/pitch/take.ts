import { confidenceGate } from '../../score/constants'
import type { Curve } from '../../score/curve'
import { peakOf, toDb } from '../audio/level'
import { createOnsetFinder } from './onset'
import { type SwiftF0Inference, swiftF0FrameHz, trackFrames } from './swift-f0'

// From a whole take at 16 kHz to its curve, or to the reason it has none:
// scale a quiet take, track it, gate the frames by confidence, and find
// the voice's onset.

// SwiftF0 tracks a take whose peak is below about -35 dBFS poorly, so such
// a take is scaled before tracking (report section 7).
export const quietPeakDb = -35
// A scaled take peaks here...
const scaledPeakDb = -20
// ...or as near as this much gain takes it, so noise is not raised
// without end.
const largestGainDb = 30
// A take with less voice than this has nothing to draw: 16 frames is
// 256 ms, under a single short mora pair.
export const fewestVoicedFrames = 16
// Below this peak a take with too little voice was too quiet: the
// microphone heard almost nothing, rather than sound with no voice in it.
export const tooQuietPeakDb = -50
// A take whose voiced frames stand less than this above its unvoiced
// ones, by their median levels, was too noisy to trust, however much it
// tracked: the room was nearly as loud as the voice.
export const fewestDbOverNoise = 10
// With fewer unvoiced frames than this (a take voiced from end to end)
// there is no room sound to measure, and the check is skipped.
const fewestNoiseFrames = 8

export type TakeAnalysis =
  | Readonly<{
      _tag: 'Tracked'
      curve: Curve
      peakDb: number
      gainDb: number
    }>
  | Readonly<{ _tag: 'TooQuiet'; peakDb: number }>
  | Readonly<{ _tag: 'TooNoisy'; peakDb: number }>

// The gain, in dB, that a take peaking at `peakDb` is tracked with.
export const quietTakeGainDb = (peakDb: number): number =>
  peakDb < quietPeakDb ? Math.min(scaledPeakDb - peakDb, largestGainDb) : 0

const quantile = (values: Float32Array, q: number): number => {
  const sorted = values.slice().sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

const onsetOf = (f0Hz: Float32Array): number =>
  createOnsetFinder().push(0, f0Hz) ?? 0

export const analyseTake = async (
  samples: Float32Array,
  infer: SwiftF0Inference,
): Promise<TakeAnalysis> => {
  const peakDb = toDb(peakOf(samples))
  const gainDb = quietTakeGainDb(peakDb)
  const gain = 10 ** (gainDb / 20)
  const tracked = await trackFrames(
    gain === 1 ? samples : samples.map(sample => sample * gain),
    infer,
  )

  const f0Hz = tracked.pitchHz.map((hz, frame) =>
    (tracked.confidence[frame] ?? 0) >= confidenceGate ? hz : 0,
  )
  // The level the microphone heard, before the scaling.
  const levelDb = tracked.levelDb.map(level => level - gainDb)
  const voicedLevels = levelDb.filter((_, frame) => (f0Hz[frame] ?? 0) > 0)
  const unvoicedLevels = levelDb.filter((_, frame) => (f0Hz[frame] ?? 0) === 0)

  if (voicedLevels.length < fewestVoicedFrames) {
    return peakDb < tooQuietPeakDb
      ? { _tag: 'TooQuiet', peakDb }
      : { _tag: 'TooNoisy', peakDb }
  }
  if (
    unvoicedLevels.length >= fewestNoiseFrames &&
    quantile(voicedLevels, 0.5) - quantile(unvoicedLevels, 0.5) <
      fewestDbOverNoise
  ) {
    return { _tag: 'TooNoisy', peakDb }
  }

  return {
    _tag: 'Tracked',
    curve: {
      frameHz: swiftF0FrameHz,
      f0Hz,
      confidence: tracked.confidence,
      levelDb,
      onsetFrame: onsetOf(f0Hz),
    },
    peakDb,
    gainDb,
  }
}
