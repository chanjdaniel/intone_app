import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { TrackerResult } from '../../services/tracker'

// A take, as the practice screen's Model sees it: one state at a time, so
// recording, asking and showing a result cannot overlap by construction.
// The tracker is held from Preparing to Analysing, the microphone from
// AwaitingMic to Recording (./resources.ts).

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

export const TakeResult = defineTaggedUnion({
  Tracked: { curve: TakeCurve },
  TooQuiet: {},
  TooNoisy: {},
})
export type TakeResult = typeof TakeResult.Type

// Each take is numbered, so a late timer or result from an earlier take is
// told apart from the current one.
const takeNumber = Schema.Finite

export const Take = defineTaggedUnion({
  Idle: {},
  // The tracker Worker is loading its model.
  Preparing: { takeNumber },
  // The browser is asking for the microphone.
  AwaitingMic: { takeNumber },
  // Still asking, a few seconds on: the prompt may never be answered.
  MicPromptIgnored: { takeNumber },
  // `levelDb` is the microphone's peak over the last tenth of a second,
  // from `levelMeterFloorDb` to 0; the onset is in seconds from the take's
  // start, once the voice is heard.
  Recording: {
    takeNumber,
    elapsedSeconds: Schema.Finite,
    levelDb: Schema.Finite,
    maybeOnsetSeconds: Schema.Option(Schema.Finite),
  },
  Analysing: { takeNumber },
  ShowingResult: { takeNumber, result: TakeResult },
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

// Whether a new take may start from here.
export const canStartTake = (take: Take): boolean =>
  takeNeedingTracker(take).pipe(Option.isNone)

export const takeResultOf = (result: TrackerResult): TakeResult =>
  result._tag === 'Tracked'
    ? TakeResult.Tracked({
        curve: {
          frameHz: result.frameHz,
          f0Hz: Array.from(result.f0Hz),
          confidence: Array.from(result.confidence),
          levelDb: Array.from(result.levelDb),
          onsetFrame: result.onsetFrame,
        },
      })
    : result._tag === 'TooQuiet'
      ? TakeResult.TooQuiet()
      : TakeResult.TooNoisy()
