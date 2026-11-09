import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Recording } from '../../score/score'
import {
  type SyntheticTake,
  syntheticTake,
  withGap,
} from '../../score/synthetic-take'
import { compareTake } from '../../services/compare-take'
import {
  type FinishedTake,
  KeptInHistory,
  type NativeRecording,
  TakeResult,
  takeCurveOf,
  takeFeaturesOf,
  takeScoreOf,
} from '../take/take'

// Scored takes for the library, never typed in: seeded synthetic
// recordings of 雨が好き's shape (src/score/synthetic-take.ts), each take
// a lower voice copying the line, scored by the app's own score. Only
// "not provisional" is made by hand, by turning the flag off, since every
// score is provisional until ticket 22.

// H L L L H, as the score's own tests copy it.
const line = [true, false, false, false, true]

const nativeTake: SyntheticTake = {
  pattern: line,
  moraFrames: 9,
  registerHz: 220,
  spanSemitones: 5,
  seed: 1,
}

// A lower, narrower voice, unevenly paced and unsteady in pitch, as a
// learner's might be.
const takeOf = (change: Partial<SyntheticTake>): SyntheticTake => ({
  pattern: line,
  moraFrames: [7, 13, 8, 12, 10],
  registerHz: 130,
  spanSemitones: 3,
  jitter: 1.5,
  seed: 104,
  colour: 1.5,
  ...change,
})

const nativeRecording = syntheticTake(nativeTake)

export const sampleNative: NativeRecording = {
  curve: takeCurveOf(nativeRecording.curve),
  features: takeFeaturesOf(nativeRecording.features),
}

const kept = KeptInHistory.Kept({
  id: 'sample-take',
  maybeAudioFailure: Option.none(),
})

const finished = (
  change: Partial<SyntheticTake>,
  edit: (recording: Recording) => Recording = recording => recording,
): FinishedTake => {
  const take = edit(syntheticTake(takeOf(change)))
  const score = takeScoreOf(compareTake(nativeRecording, take), nativeRecording)
  return {
    takeNumber: 1,
    result: TakeResult.Tracked({
      curve: takeCurveOf(take.curve),
      score,
      kept,
    }),
  }
}

const withProvisional = (
  take: FinishedTake,
  provisional: boolean,
): FinishedTake => {
  const result = take.result
  if (result._tag !== 'Tracked' || result.score._tag !== 'Scored') {
    return take
  }
  const score = modifyFields(result.score, { provisional: () => provisional })
  return modifyFields(take, {
    result: () =>
      TakeResult.Tracked({ curve: result.curve, score, kept: result.kept }),
  })
}

const copied = finished({})

export const sampleScoreNames = [
  'Scored',
  'Provisional',
  'Fall held',
  'Too quiet',
  'Too little voiced',
  'Length far off',
] as const
export type SampleScoreName = (typeof sampleScoreNames)[number]

export const sampleScores: Readonly<Record<SampleScoreName, FinishedTake>> = {
  Scored: withProvisional(copied, false),
  Provisional: copied,
  // The fourth mora held high: the accent's fall comes late.
  'Fall held': finished({ pattern: [true, false, false, true, true] }),
  // Most of the line unvoiced, said quietly or not.
  'Too quiet': finished({ levelDb: -62, silenceDb: -90 }, recording =>
    withGap(recording, 30, 66),
  ),
  'Too little voiced': finished({}, recording => withGap(recording, 30, 66)),
  'Length far off': finished({ moraFrames: 22 }),
}
