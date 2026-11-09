import type { Curve } from '../../score/curve'
import { spectralFeatures } from '../features/spectral'
import type { SwiftF0Inference } from '../pitch/swift-f0'
import { analyseTake } from '../pitch/take'
import { type CutRules, cutLines, cutRules } from './lines'
import { type LineQuality, lineQuality } from './quality'
import {
  type SileroInference,
  sileroWindow,
  speechProbabilities,
} from './silero'

// A whole clip, at 16 kHz, cut into lines and each line's native curve
// found: Silero VAD finds the speech, `cutLines` cuts it at its pauses,
// and each line goes through the take's own tracking (`analyseTake`) and
// spectral features, so a line's curve is made exactly as a take's is.
// Each tracked line's quality (./quality.ts) pairs its curve with
// Silero's windows over it. `trackSpans` does the same for lines the
// learner has moved, split or merged (./edit.ts).

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
        quality: LineQuality
      }>
    | Readonly<{ _tag: 'TooQuiet' | 'TooNoisy' }>
}>

export type ClipProgress =
  // Speech found in `done` of `total` 32 ms windows.
  | Readonly<{ _tag: 'FindingLines'; done: number; total: number }>
  // `done` of `total` lines tracked.
  | Readonly<{ _tag: 'TrackingLines'; done: number; total: number }>

export type ClipModels = Readonly<{
  speech: SileroInference
  pitch: SwiftF0Inference
}>

// One line's curve, features and quality, from the clip's `samples` and
// Silero's `probabilities` for windows from sample `probabilitiesFrom`.
const trackLine = async (
  samples: Float32Array,
  span: Readonly<{ from: number; to: number }>,
  pitch: SwiftF0Inference,
  probabilities: Float32Array,
  probabilitiesFrom: number,
): Promise<ClipLine> => {
  const audio = samples.slice(span.from, span.to)
  const analysis = await analyseTake(audio, pitch)
  if (analysis._tag !== 'Tracked') {
    return { ...span, curve: { _tag: analysis._tag } }
  }
  const features = spectralFeatures(audio)
  return {
    ...span,
    curve: {
      _tag: 'Tracked',
      curve: analysis.curve,
      featureDims: features.dims,
      features: features.data,
      quality: lineQuality(
        analysis.curve.f0Hz,
        span.from,
        probabilities,
        probabilitiesFrom,
      ),
    },
  }
}

export const analyseClip = async (
  samples: Float32Array,
  models: ClipModels,
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
    lines.push(await trackLine(samples, cut, models.pitch, probabilities, 0))
    await progress({
      _tag: 'TrackingLines',
      done: lines.length,
      total: cuts.length,
    })
  }
  return lines
}

// Silero carries a state from window to window, so a span's speech is
// found with this much of the clip before it run first, on the clip's
// own window grid, as the whole clip's cut found it.
const speechLeadSamples = 16 * sileroWindow

// The lines at `spans` of the clip, each tracked as a cut line is: what a
// moved, split or merged line is tracked again with.
export const trackSpans = async (
  samples: Float32Array,
  spans: ReadonlyArray<Readonly<{ from: number; to: number }>>,
  models: ClipModels,
  progress: () => Promise<void> | void = () => undefined,
): Promise<ReadonlyArray<ClipLine>> => {
  const lines: Array<ClipLine> = []
  for (const span of spans) {
    const lead =
      Math.max(0, Math.floor(span.from / sileroWindow) * sileroWindow) -
      speechLeadSamples
    const probabilitiesFrom = Math.max(0, lead)
    const probabilities = await speechProbabilities(
      samples.subarray(probabilitiesFrom, span.to),
      models.speech,
    )
    lines.push(
      await trackLine(
        samples,
        span,
        models.pitch,
        probabilities,
        probabilitiesFrom,
      ),
    )
    await progress()
  }
  return lines
}
