import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { Recording } from '../../score/score'
import { TakeMode } from '../../services/history-records'
import type { Comparison } from '../../services/scorer'
import { TakeOutcome } from '../level/progress'

// A take, as the practice screen's Model sees it: one state at a time, so
// playing, recording, asking and showing a result cannot overlap by
// construction. A take plays the line first (PlayingNative), and the
// microphone opens only once it has ended; listening again to either
// voice (Listening) is a state of its own, outside any take. The tracker
// is held from PlayingNative to Analysing, the microphone from
// AwaitingMic to Recording (./resources.ts), and a voice plays only in
// PlayingNative and Listening (./subscriptions.ts).
//
// A take is guided, with the native's curve and the learner's drawn as
// they speak, or blind, with both hidden, and the level and closeness
// with them, from its start until it ends (report section 5); its mode
// goes with it from PlayingNative to its result, which shows everything.
export { TakeMode } from '../../services/history-records'

// The finished curve, the one time pitch frames enter the Model: plain
// arrays, so the Model stays a plain Schema value.
export const TakeCurve = Schema.Struct({
  frameHz: Schema.Finite,
  f0Hz: Schema.Array(Schema.Finite),
  confidence: Schema.Array(Schema.Finite),
  levelDb: Schema.Array(Schema.Finite),
  onsetFrame: Schema.Finite,
})
export type TakeCurve = typeof TakeCurve.Type

// A recording's spectral features, for the score's aligner: `dims`
// values per frame, frame by frame. Only the native's are kept in the
// Model, so a take can be scored against them; a take's own go straight
// from the tracker to the score.
export const TakeFeatures = Schema.Struct({
  frameHz: Schema.Finite,
  dims: Schema.Finite,
  data: Schema.Array(Schema.Finite),
})
export type TakeFeatures = typeof TakeFeatures.Type

// The native's curve and features, as the score reads them.
export const NativeRecording = Schema.Struct({
  curve: TakeCurve,
  features: TakeFeatures,
})
export type NativeRecording = typeof NativeRecording.Type

export const CouldNotCompareReason = Schema.Literals([
  'TooLittleVoiced',
  'LengthMismatch',
  'TooQuiet',
])
export type CouldNotCompareReason = typeof CouldNotCompareReason.Type

// The take's score (src/score/score.ts, `Score`), as the Model keeps it.
// A scored take also keeps its pitch at each of the native's frames,
// through the alignment the score made, which is how the result draws it.
export const TakeScore = defineTaggedUnion({
  Scored: {
    version: Schema.Finite,
    // 0 to 1, as each part.
    match: Schema.Finite,
    parts: Schema.Struct({
      pitchAccent: Schema.Finite,
      timing: Schema.Finite,
      maybeSounds: Schema.Option(Schema.Finite),
    }),
    // Seconds from the start of each recording.
    worstStretch: Schema.Struct({
      nativeFrom: Schema.Finite,
      nativeTo: Schema.Finite,
      takeFrom: Schema.Finite,
      takeTo: Schema.Finite,
    }),
    provisional: Schema.Boolean,
    // Hz, 0 where unvoiced or not compared, one per native frame.
    alignedF0: Schema.Array(Schema.Finite),
  },
  CouldNotCompare: { version: Schema.Finite, reason: CouldNotCompareReason },
})
export type TakeScore = typeof TakeScore.Type

// Whether a tracked take was kept in the history on the device
// (../../services/history-store.ts), and why its audio was not, when the
// learner had asked for it and it could not be.
export const KeptInHistory = defineTaggedUnion({
  Kept: {
    id: Schema.String,
    // The learner's day the take was kept on, which its line's next
    // return is reckoned from.
    day: Schema.String,
    maybeAudioFailure: Schema.Option(Schema.String),
  },
  NotKept: { reason: Schema.String },
})
export type KeptInHistory = typeof KeptInHistory.Type

export const TakeResult = defineTaggedUnion({
  Tracked: { curve: TakeCurve, score: TakeScore, kept: KeptInHistory },
  TooQuiet: {},
  TooNoisy: {},
})
export type TakeResult = typeof TakeResult.Type

// Each take is numbered, so a late timer or result from an earlier take is
// told apart from the current one.
const takeNumber = Schema.Finite

// The voice to listen to: the native line, or the learner's last take.
export const Voice = Schema.Literals(['Line', 'Take'])
export type Voice = typeof Voice.Type

// How much of a voice to listen to: all of it, or the worst stretch of a
// scored take, the 400 ms of the line where the take differed most, and
// the part of the take the score paired with it.
export const Extent = Schema.Literals(['Whole', 'WorstStretch'])
export type Extent = typeof Extent.Type

const mode = TakeMode

// A finished take, kept while its voices are listened to again, with
// what it did for its line's stars and best (../level/progress.ts), once
// it was kept and the line's were known.
const finishedFields = {
  takeNumber,
  mode,
  result: TakeResult,
  maybeOutcome: Schema.Option(TakeOutcome),
}
export const FinishedTake = Schema.Struct(finishedFields)
export type FinishedTake = typeof FinishedTake.Type

export const Take = defineTaggedUnion({
  Idle: {},
  // The line plays before the take, while the tracker Worker loads.
  PlayingNative: {
    takeNumber,
    mode,
    tracker: Schema.Literals(['Loading', 'Ready']),
  },
  // The line has played and the tracker Worker is still loading.
  Preparing: { takeNumber, mode },
  // The browser is asking for the microphone.
  AwaitingMic: { takeNumber, mode },
  // Still asking, a few seconds on: the prompt may never be answered.
  MicPromptIgnored: { takeNumber, mode },
  // `levelDb` is the microphone's peak over the last tenth of a second,
  // from `levelMeterFloorDb` to 0; the onset is in seconds from the take's
  // start, once the voice is heard.
  Recording: {
    takeNumber,
    mode,
    elapsedSeconds: Schema.Finite,
    levelDb: Schema.Finite,
    maybeOnsetSeconds: Schema.Option(Schema.Finite),
  },
  Analysing: { takeNumber, mode },
  ShowingResult: finishedFields,
  // Listening again, from the start or from the take it came from.
  Listening: {
    voice: Voice,
    extent: Extent,
    maybeTake: Schema.Option(FinishedTake),
  },
  MicDenied: {},
  NoMicDevice: {},
  MicFailed: { reason: Schema.String },
  AnalysisFailed: { reason: Schema.String },
})
export type Take = typeof Take.Type

// A take stops by itself after this long, so a forgotten one ends.
export const longestTakeSeconds = 30

// The level meter's floor, in dBFS: quieter shows as an empty meter.
export const levelMeterFloorDb = -60

// How long the browser's prompt may wait before the screen says how to
// find it.
export const micPromptPatienceSeconds = 4

const takeNumberIn =
  (tags: ReadonlyArray<Take['_tag']>) =>
  (take: Take): Option.Option<number> =>
    tags.includes(take._tag) && 'takeNumber' in take
      ? Option.some(take.takeNumber)
      : Option.none()

// The take that needs the tracker, the microphone, or a running recording.
export const takeNeedingTracker = takeNumberIn([
  'PlayingNative',
  'Preparing',
  'AwaitingMic',
  'MicPromptIgnored',
  'Recording',
  'Analysing',
])
export const takeNeedingMicrophone = takeNumberIn([
  'AwaitingMic',
  'MicPromptIgnored',
  'Recording',
])
export const recordingTake = takeNumberIn(['Recording'])

// The worst stretch of a finished take, if it was scored.
export const worstStretchOf = (
  result: TakeResult,
): Option.Option<Extract<TakeScore, { _tag: 'Scored' }>['worstStretch']> =>
  result._tag === 'Tracked' && result.score._tag === 'Scored'
    ? Option.some(result.score.worstStretch)
    : Option.none()

// The mode of the take under way, if one is.
export const runningMode = (take: Take): Option.Option<TakeMode> =>
  'mode' in take && take._tag !== 'ShowingResult'
    ? Option.some(take.mode)
    : Option.none()

// Whether `take` is a blind take under way, whose curves and feedback are
// hidden until it ends.
export const isBlindUnderWay = (take: Take): boolean =>
  Option.contains(runningMode(take), 'Blind')

// Whether a new take may start from here.
export const canStartTake = (take: Take): boolean =>
  takeNeedingTracker(take).pipe(Option.isNone)

// A curve or features from the tracker's arrays, for the Model, and back
// for the score: Float32 values survive the trip exactly.
export const takeCurveOf = (curve: Recording['curve']): TakeCurve => ({
  frameHz: curve.frameHz,
  f0Hz: Array.from(curve.f0Hz),
  confidence: Array.from(curve.confidence),
  levelDb: Array.from(curve.levelDb),
  onsetFrame: curve.onsetFrame,
})

export const takeFeaturesOf = (
  features: Recording['features'],
): TakeFeatures => ({
  frameHz: features.frameHz,
  dims: features.dims,
  data: Array.from(features.data),
})

export const recordingOfNative = (native: NativeRecording): Recording => ({
  curve: {
    frameHz: native.curve.frameHz,
    f0Hz: Float32Array.from(native.curve.f0Hz),
    confidence: Float32Array.from(native.curve.confidence),
    levelDb: Float32Array.from(native.curve.levelDb),
    onsetFrame: native.curve.onsetFrame,
  },
  features: {
    frameHz: native.features.frameHz,
    dims: native.features.dims,
    data: Float32Array.from(native.features.data),
  },
})

// The score of a take against `native`, as the Model keeps it.
export const takeScoreOf = (
  comparison: Comparison,
  native: Recording,
): TakeScore => {
  const { score, alignedTakeF0 } = comparison
  if (score._tag === 'CouldNotCompare') {
    return TakeScore.CouldNotCompare({
      version: score.version,
      reason: score.reason,
    })
  }
  return TakeScore.Scored({
    version: score.version,
    match: score.match,
    parts: {
      pitchAccent: score.parts.pitchAccent,
      timing: score.parts.timing,
      maybeSounds: Option.fromNullishOr(score.parts.sounds),
    },
    worstStretch: score.worstStretch,
    provisional: score.provisional,
    alignedF0:
      alignedTakeF0 === null
        ? Array.from({ length: native.curve.f0Hz.length }, () => 0)
        : Array.from(alignedTakeF0),
  })
}
