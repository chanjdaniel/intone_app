import {
  type Aligner,
  type AlignmentPath,
  dtwAligner,
  normaliseFeatures,
  stretchAligner,
  withFallback,
} from './align'
import { fitPitch, localSkill, pairPitch, tempoDeviation } from './compare'
import {
  SCORE_VERSION,
  dtwBandSeconds,
  dtwBandShare,
  dtwFailDistance,
  leastVoicedShare,
  lengthRatioBand,
  loudEndQuantile,
  partWeights,
  pitchSkillTop,
  timingDeviationTop,
  timingDeviationZero,
  tooQuietLevelDb,
  worstStretchSeconds,
} from './constants'
import type { Curve } from './curve'
import type { Features } from './features'
import { pitchTrack } from './track'

// The score of a take against the native (spec, "The score's interface"):
// the native's and the take's curves and features in, a `Score` out.

export type Recording = Readonly<{ curve: Curve; features: Features }>

export type Score =
  | Readonly<{
      _tag: 'Scored'
      version: number
      // 0 to 1: the parts' weighted mean.
      match: number
      parts: Readonly<{ pitchAccent: number; timing: number; sounds?: number }>
      // Seconds from the start of each recording.
      worstStretch: Readonly<{
        nativeFrom: number
        nativeTo: number
        takeFrom: number
        takeTo: number
      }>
      // True until ticket 22 anchors the top of the scale.
      provisional: boolean
    }>
  | Readonly<{
      _tag: 'CouldNotCompare'
      version: number
      reason: 'TooLittleVoiced' | 'LengthMismatch' | 'TooQuiet'
    }>

// What the score lines recordings up with (docs/score.md, "The aligner"):
// DTW over the features, or the take stretched evenly where DTW finds no
// path worth taking.
export const chosenAligner: Aligner = withFallback(
  dtwAligner({
    bandShare: dtwBandShare,
    bandSeconds: dtwBandSeconds,
    failDistance: dtwFailDistance,
  }),
  stretchAligner,
)

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

// The loud end of the take's level: under `tooQuietLevelDb` the
// microphone heard almost nothing.
const loudLevelDb = (curve: Curve): number => {
  const sorted = curve.levelDb.slice().sort()
  return (
    sorted[Math.floor(loudEndQuantile * (sorted.length - 1))] ??
    Number.NEGATIVE_INFINITY
  )
}

// A score and the raw measures behind it, read only by docs/score.md's
// study (tests/support/score-study.ts); the app and its tests score
// through `scoreTake`.
export type ScoreDetail = Readonly<{
  score: Score
  // The pitch skill before the scale's top, and the tempo deviation.
  pitchSkill: number
  tempoDeviation: number
  gain: number
  // The pairs of frames the score lined up, in each curve's own frames,
  // or null when it could not compare.
  alignment: AlignmentPath | null
}>

export const scoreDetail = (
  native: Recording,
  take: Recording,
  aligner: Aligner = chosenAligner,
): ScoreDetail => {
  const couldNot = (
    reason: 'TooLittleVoiced' | 'LengthMismatch' | 'TooQuiet',
  ): ScoreDetail => ({
    score: { _tag: 'CouldNotCompare', version: SCORE_VERSION, reason },
    pitchSkill: Number.NaN,
    tempoDeviation: Number.NaN,
    gain: Number.NaN,
    alignment: null,
  })
  const nativeTrack = pitchTrack(native.curve)
  const takeTrack = pitchTrack(take.curve)
  const nativeLength = nativeTrack.to - nativeTrack.from
  const takeLength = takeTrack.to - takeTrack.from

  if (
    nativeLength === 0 ||
    takeTrack.voicedFrames < leastVoicedShare * nativeTrack.voicedFrames
  ) {
    return couldNot(
      loudLevelDb(take.curve) < tooQuietLevelDb
        ? 'TooQuiet'
        : 'TooLittleVoiced',
    )
  }
  const ratio = takeLength / nativeLength
  if (ratio < lengthRatioBand.least || ratio > lengthRatioBand.most) {
    return couldNot('LengthMismatch')
  }

  const nativeFeatures = normaliseFeatures(
    native.features,
    nativeTrack.from,
    nativeTrack.to,
  )
  const takeFeatures = normaliseFeatures(
    take.features,
    takeTrack.from,
    takeTrack.to,
  )
  const path = aligner.align(nativeFeatures, takeFeatures)
  if (path === null) {
    return couldNot('TooLittleVoiced')
  }

  const paired = pairPitch(nativeTrack, takeTrack, path)
  const fit = fitPitch(paired)
  const deviation = tempoDeviation(
    nativeLength,
    takeLength,
    path,
    native.curve.frameHz,
  )
  const pitchAccent = clamp01(fit.skill / pitchSkillTop)
  const timing = clamp01(
    1 -
      Math.max(0, deviation - timingDeviationTop) /
        (timingDeviationZero - timingDeviationTop),
  )

  // The worst stretch: the window of the native with the lowest local
  // pitch skill, and the take frames the path pairs with it.
  const window = Math.min(
    nativeLength,
    Math.round(worstStretchSeconds * native.curve.frameHz),
  )
  let worstFrom = 0
  let worst = Number.POSITIVE_INFINITY
  for (let i = 0; i + window <= nativeLength; i++) {
    const local = localSkill(paired, fit, i, i + window)
    if (local !== null && local < worst) {
      worst = local
      worstFrom = i
    }
  }
  let takeFrom = Number.POSITIVE_INFINITY
  let takeTo = Number.NEGATIVE_INFINITY
  for (let k = 0; k < path.native.length; k++) {
    const i = path.native[k] ?? 0
    if (i >= worstFrom && i < worstFrom + window) {
      const j = path.take[k] ?? 0
      takeFrom = Math.min(takeFrom, j)
      takeTo = Math.max(takeTo, j + 1)
    }
  }
  const nativeSeconds = (frame: number) =>
    (frame + nativeTrack.from) / native.curve.frameHz
  const takeSeconds = (frame: number) =>
    (frame + takeTrack.from) / take.curve.frameHz

  return {
    score: {
      _tag: 'Scored',
      version: SCORE_VERSION,
      match:
        partWeights.pitchAccent * pitchAccent + partWeights.timing * timing,
      parts: { pitchAccent, timing },
      worstStretch: {
        nativeFrom: nativeSeconds(worstFrom),
        nativeTo: nativeSeconds(worstFrom + window),
        takeFrom: takeSeconds(takeFrom),
        takeTo: takeSeconds(takeTo),
      },
      provisional: true,
    },
    pitchSkill: fit.skill,
    tempoDeviation: deviation,
    gain: fit.gain,
    alignment: {
      native: path.native.map(frame => frame + nativeTrack.from),
      take: path.take.map(frame => frame + takeTrack.from),
    },
  }
}

// The score's one way in: the score of `take` copying `native`, and the
// pairs of frames it lined up, for drawing the take over the native where
// it was compared (`alignedTakeF0`), or null when it could not compare.
export type ScoredTake = Readonly<{
  score: Score
  alignment: AlignmentPath | null
}>

export const scoreTake = (native: Recording, take: Recording): ScoredTake => {
  const { score, alignment } = scoreDetail(native, take)
  return { score, alignment }
}
