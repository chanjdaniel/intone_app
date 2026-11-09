import { Option } from 'effect'

import {
  KeptInHistory,
  type TakeCurve,
  type TakeFeatures,
  TakeScore,
} from './take'

// A short curve, its features and a score, for the app's own tests to
// put in a Model; nothing in the app imports them.
export const sampleCurve: TakeCurve = {
  frameHz: 62.5,
  f0Hz: [0, 200, 210, 220, 200, 180, 170, 0],
  confidence: [0.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.1],
  levelDb: [-80, -20, -20, -20, -20, -20, -20, -80],
  onsetFrame: 1,
}

export const sampleFeatures: TakeFeatures = {
  frameHz: 62.5,
  dims: 2,
  data: [0, 0, 1, 2, 2, 1, 3, 3, 1, 1, 0, 2, 2, 0, 0, 0],
}

// A score of a take of `sampleCurve`, its worst stretch on frames 2 to 4
// of the line and 3 to 5 of the take.
export const sampleScore = TakeScore.Scored({
  version: 1,
  match: 0.824,
  parts: { pitchAccent: 0.756, timing: 0.926, maybeSounds: Option.none() },
  worstStretch: {
    nativeFrom: 0.032,
    nativeTo: 0.064,
    takeFrom: 0.048,
    takeTo: 0.08,
  },
  provisional: true,
  alignedF0: [0, 105, 108, 112, 0, 104, 100, 0],
})

// A take kept in the history.
export const sampleKept = KeptInHistory.Kept({
  id: 'sample-take',
  maybeAudioFailure: Option.none(),
})
