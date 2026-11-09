import type { Curve } from '../../score/curve'
import { spectralFeatures } from '../features/spectral'
import type { SwiftF0Inference } from '../pitch/swift-f0'
import { analyseTake } from '../pitch/take'
import { type CutRules, cutLines, cutRules } from './lines'
import {
  type SileroInference,
  sileroWindow,
  speechProbabilities,
} from './silero'

// A whole clip, at 16 kHz, cut into lines and each line's native curve
// found: Silero VAD finds the speech, `cutLines` cuts it at its pauses,
// and each line goes through the take's own tracking (`analyseTake`) and
// spectral features, so a line's curve is made exactly as a take's is.

export type ClipLine = Readonly<{
  // Samples of the 16 kHz clip, from `from` up to `to`.
  from: number
  to: number
  curve:
    | Readonly<{
        _tag: 'Tracked'
        curve: Curve
        featureDims: number
        features: Float32Array
      }>
    | Readonly<{ _tag: 'TooQuiet' | 'TooNoisy' }>
}>

export type ClipProgress =
  // Speech found in `done` of `total` 32 ms windows.
  | Readonly<{ _tag: 'FindingLines'; done: number; total: number }>
  // `done` of `total` lines tracked.
  | Readonly<{ _tag: 'TrackingLines'; done: number; total: number }>

export const analyseClip = async (
  samples: Float32Array,
  models: Readonly<{ speech: SileroInference; pitch: SwiftF0Inference }>,
  progress: (step: ClipProgress) => Promise<void> | void,
  rules: CutRules = cutRules,
): Promise<ReadonlyArray<ClipLine>> => {
  const probabilities = await speechProbabilities(
    samples,
    models.speech,
    (done, total) => progress({ _tag: 'FindingLines', done, total }),
  )
  const cuts = cutLines(probabilities, sileroWindow, samples.length, rules)
  await progress({ _tag: 'TrackingLines', done: 0, total: cuts.length })
  const lines: Array<ClipLine> = []
  for (const cut of cuts) {
    const audio = samples.slice(cut.from, cut.to)
    const analysis = await analyseTake(audio, models.pitch)
    if (analysis._tag === 'Tracked') {
      const features = spectralFeatures(audio)
      lines.push({
        ...cut,
        curve: {
          _tag: 'Tracked',
          curve: analysis.curve,
          featureDims: features.dims,
          features: features.data,
        },
      })
    } else {
      lines.push({ ...cut, curve: { _tag: analysis._tag } })
    }
    await progress({
      _tag: 'TrackingLines',
      done: lines.length,
      total: cuts.length,
    })
  }
  return lines
}
