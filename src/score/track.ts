import {
  confidenceGate,
  levelGateDb,
  octaveFilterFrames,
  speechOverNoiseDb,
  speechSpanLevelDb,
  speechSpanReachSeconds,
  voiceRunFrames,
} from './constants'
import { type Curve, semitonesFrom } from './curve'

// A curve made ready to compare: the frames the score trusts, filtered of
// octave jumps, in semitones around the speaker's own median, and the
// stretch of the recording that holds the speech. A gap stays a gap.

export type PitchTrack = Readonly<{
  frameHz: number
  // Semitones around the speaker's median at each frame, where `voiced`.
  semitones: Float64Array
  // 1 where the frame is voiced and trusted.
  voiced: Uint8Array
  // How many frames are voiced.
  voicedFrames: number
  // The speech, frames `from` to `to` (exclusive): the first run of voice
  // to the last, and the sound just past them (docs/score.md, "The
  // speech"). Empty (`from === to`) when there is no run of voice.
  from: number
  to: number
}>

const median = (values: Array<number>): number => {
  values.sort((a, b) => a - b)
  const middle = values.length >> 1
  return values.length % 2 === 1
    ? (values[middle] ?? 0)
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2
}

// Frames the score trusts: voiced at or above the confidence gate, and no
// more than `levelGateDb` under the voiced frames' median level, so a
// quieter voice in the room behind the speaker is a gap.
const trustedFrames = (curve: Curve): Uint8Array => {
  const frames = curve.f0Hz.length
  const confident = new Uint8Array(frames)
  const levels: Array<number> = []
  for (let f = 0; f < frames; f++) {
    if (
      (curve.f0Hz[f] ?? 0) > 0 &&
      (curve.confidence[f] ?? 0) >= confidenceGate
    ) {
      confident[f] = 1
      levels.push(curve.levelDb[f] ?? 0)
    }
  }
  if (levels.length === 0) {
    return confident
  }
  const floor = median(levels) - levelGateDb
  for (let f = 0; f < frames; f++) {
    if (confident[f] === 1 && (curve.levelDb[f] ?? 0) < floor) {
      confident[f] = 0
    }
  }
  return confident
}

// The first frame of the first run of `voiceRunFrames` voiced frames, and
// one past the last frame of the last such run, or null with no run.
const voiceRuns = (
  voiced: Uint8Array,
): Readonly<{ first: number; end: number }> | null => {
  let first = -1
  let end = -1
  let run = 0
  for (let f = 0; f < voiced.length; f++) {
    run = voiced[f] === 1 ? run + 1 : 0
    if (run >= voiceRunFrames) {
      if (first < 0) {
        first = f - voiceRunFrames + 1
      }
      end = f + 1
    }
  }
  return first < 0 ? null : { first, end }
}

export const pitchTrack = (curve: Curve): PitchTrack => {
  const frames = curve.f0Hz.length
  const trusted = trustedFrames(curve)
  const semitones = new Float64Array(frames)
  const voiced = new Uint8Array(frames)
  const runs = voiceRuns(trusted)
  if (runs === null) {
    return {
      frameHz: curve.frameHz,
      semitones,
      voiced,
      voicedFrames: 0,
      from: 0,
      to: 0,
    }
  }

  // Each trusted frame becomes the median of the trusted frames within
  // half the filter either side: an octave jump of a frame or two is
  // outvoted by the frames around it.
  const half = octaveFilterFrames >> 1
  const filtered = new Float64Array(frames)
  const window: Array<number> = []
  const kept: Array<number> = []
  for (let f = 0; f < frames; f++) {
    if (trusted[f] !== 1) continue
    window.length = 0
    for (
      let g = Math.max(0, f - half);
      g <= Math.min(frames - 1, f + half);
      g++
    ) {
      if (trusted[g] === 1) {
        window.push(Math.log2(curve.f0Hz[g] ?? 1))
      }
    }
    filtered[f] = median(window)
    kept.push(filtered[f] ?? 0)
  }
  const centreHz = 2 ** median(kept.slice())
  let voicedFrames = 0
  for (let f = 0; f < frames; f++) {
    if (trusted[f] === 1) {
      voiced[f] = 1
      voicedFrames++
      semitones[f] = semitonesFrom(centreHz, 2 ** (filtered[f] ?? 0))
    }
  }

  // The speech reaches out from the voice to the furthest run of
  // `voiceRunFrames` frames within `speechSpanReachSeconds` that stand
  // clear of the recording's own noise floor (its quietest tenth) and
  // within `speechSpanLevelDb` of the voice: a voiceless consonant, or a
  // short weak mora the tracker lost, at either end.
  const levels: Array<number> = []
  for (let f = 0; f < frames; f++) {
    if (trusted[f] === 1) levels.push(curve.levelDb[f] ?? 0)
  }
  const sortedLevels = Array.from(curve.levelDb).sort((a, b) => a - b)
  const noiseDb = sortedLevels[Math.floor(0.1 * (sortedLevels.length - 1))] ?? 0
  const floor = Math.max(
    noiseDb + speechOverNoiseDb,
    median(levels) - speechSpanLevelDb,
  )
  const reach = Math.round(speechSpanReachSeconds * curve.frameHz)
  const loud = (f: number) =>
    (curve.levelDb[f] ?? Number.NEGATIVE_INFINITY) >= floor
  let from = runs.first
  let run = 0
  for (let f = runs.first - 1; f >= Math.max(0, runs.first - reach); f--) {
    run = loud(f) ? run + 1 : 0
    if (run >= voiceRunFrames) from = f
  }
  let to = runs.end
  run = 0
  for (let f = runs.end; f < Math.min(frames, runs.end + reach); f++) {
    run = loud(f) ? run + 1 : 0
    if (run >= voiceRunFrames) to = f + 1
  }

  return { frameHz: curve.frameHz, semitones, voiced, voicedFrames, from, to }
}
