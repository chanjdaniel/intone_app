import type { AlignmentPath } from './align'
import { gainBand, timingWindowSeconds } from './constants'
import type { PitchTrack } from './track'

// The two parts' raw measures, on two pitch tracks lined up by a path
// whose frames count from each track's `from`.

// The take's pitch at each native frame of the speech: the mean of the
// voiced take frames the path pairs it with, and whether there was one.
export type PairedPitch = Readonly<{
  native: Float64Array
  take: Float64Array
  // 1 where both the native and the take are voiced at the native frame.
  both: Uint8Array
}>

export const pairPitch = (
  native: PitchTrack,
  take: PitchTrack,
  path: AlignmentPath,
): PairedPitch => {
  const frames = native.to - native.from
  const sums = new Float64Array(frames)
  const counts = new Uint16Array(frames)
  for (let k = 0; k < path.native.length; k++) {
    const i = path.native[k] ?? 0
    const j = (path.take[k] ?? 0) + take.from
    if (take.voiced[j] === 1) {
      sums[i] = (sums[i] ?? 0) + (take.semitones[j] ?? 0)
      counts[i] = (counts[i] ?? 0) + 1
    }
  }
  const nativeSemitones = new Float64Array(frames)
  const takeSemitones = new Float64Array(frames)
  const both = new Uint8Array(frames)
  for (let i = 0; i < frames; i++) {
    const f = i + native.from
    if (native.voiced[f] === 1 && (counts[i] ?? 0) > 0) {
      both[i] = 1
      nativeSemitones[i] = native.semitones[f] ?? 0
      takeSemitones[i] = (sums[i] ?? 0) / (counts[i] ?? 1)
    }
  }
  return { native: nativeSemitones, take: takeSemitones, both }
}

export type PitchFit = Readonly<{
  // The take's pitch is compared as gain x (take - takeMean) against
  // native - nativeMean.
  nativeMean: number
  takeMean: number
  gain: number
  // RMS of the native's centred pitch: one held note's error.
  nativeRms: number
  // 1 - RMSE / nativeRms: 1 matches, 0 is no better than one held note.
  skill: number
  frames: number
}>

// The skill score after one gain, fitted by least squares and clamped to
// the gain band (report section 3, "Pitch range, measured"): the take's
// range is taken out inside the band, and a flat take is not scaled up
// into a full one. `band` is for docs/score.md's study.
export const fitPitch = (
  paired: PairedPitch,
  band: Readonly<{ least: number; most: number }> = gainBand,
): PitchFit => {
  let frames = 0
  let nativeSum = 0
  let takeSum = 0
  for (let i = 0; i < paired.both.length; i++) {
    if (paired.both[i] !== 1) continue
    frames++
    nativeSum += paired.native[i] ?? 0
    takeSum += paired.take[i] ?? 0
  }
  if (frames === 0) {
    return {
      nativeMean: 0,
      takeMean: 0,
      gain: 1,
      nativeRms: 0,
      skill: 0,
      frames,
    }
  }
  const nativeMean = nativeSum / frames
  const takeMean = takeSum / frames
  let cross = 0
  let takeSquares = 0
  let nativeSquares = 0
  for (let i = 0; i < paired.both.length; i++) {
    if (paired.both[i] !== 1) continue
    const a = (paired.native[i] ?? 0) - nativeMean
    const b = (paired.take[i] ?? 0) - takeMean
    cross += a * b
    takeSquares += b * b
    nativeSquares += a * a
  }
  const fitted = takeSquares > 1e-12 ? cross / takeSquares : 1
  const gain = Math.min(band.most, Math.max(band.least, fitted))
  let errors = 0
  for (let i = 0; i < paired.both.length; i++) {
    if (paired.both[i] !== 1) continue
    const a = (paired.native[i] ?? 0) - nativeMean
    const b = (paired.take[i] ?? 0) - takeMean
    errors += (a - gain * b) ** 2
  }
  const nativeRms = Math.sqrt(nativeSquares / frames)
  const skill =
    nativeRms > 1e-9 ? 1 - Math.sqrt(errors / frames) / nativeRms : 0
  return { nativeMean, takeMean, gain, nativeRms, skill, frames }
}

// The skill over native frames `from` to `to` alone, with the whole
// take's fit, or null when fewer than a third of them are compared.
export const localSkill = (
  paired: PairedPitch,
  fit: PitchFit,
  from: number,
  to: number,
): number | null => {
  let frames = 0
  let errors = 0
  for (let i = from; i < to; i++) {
    if (paired.both[i] !== 1) continue
    frames++
    const a = (paired.native[i] ?? 0) - fit.nativeMean
    const b = (paired.take[i] ?? 0) - fit.takeMean
    errors += (a - fit.gain * b) ** 2
  }
  return frames * 3 < to - from || fit.nativeRms <= 1e-9
    ? null
    : 1 - Math.sqrt(errors / frames) / fit.nativeRms
}

// The take frame each native frame is paired with on average.
export const meanTakeFrames = (
  nativeFrames: number,
  path: AlignmentPath,
): Float64Array => {
  const sums = new Float64Array(nativeFrames)
  const counts = new Uint16Array(nativeFrames)
  for (let k = 0; k < path.native.length; k++) {
    const i = path.native[k] ?? 0
    sums[i] = (sums[i] ?? 0) + (path.take[k] ?? 0)
    counts[i] = (counts[i] ?? 0) + 1
  }
  for (let i = 0; i < nativeFrames; i++) {
    sums[i] = (sums[i] ?? 0) / Math.max(1, counts[i] ?? 0)
  }
  return sums
}

// How far the take's local tempo strays from its own overall tempo: over
// each `timingWindowSeconds` of the native, the take's frames per native
// frame against the whole take's, as the mean absolute log2 ratio. A take
// slower or faster throughout strays nowhere (report section 3, after
// McIntosh and colleagues' tempo irregularity).
export const tempoDeviation = (
  nativeFrames: number,
  takeFrames: number,
  path: AlignmentPath,
  frameHz: number,
): number => {
  if (nativeFrames < 2 || takeFrames < 2) {
    return 0
  }
  const mapped = meanTakeFrames(nativeFrames, path)
  const tempo = (takeFrames - 1) / (nativeFrames - 1)
  const window = Math.max(
    1,
    Math.min(nativeFrames - 1, Math.round(timingWindowSeconds * frameHz)),
  )
  // A local tempo under a quarter of the take's, or over four times it,
  // counts as that: a pause or a skip, by two octaves of tempo.
  const most = 2
  let sum = 0
  let windows = 0
  for (let i = 0; i + window < nativeFrames; i++) {
    const local = ((mapped[i + window] ?? 0) - (mapped[i] ?? 0)) / window
    const ratio = local / tempo
    sum += ratio > 0 ? Math.min(most, Math.abs(Math.log2(ratio))) : most
    windows++
  }
  return windows > 0 ? sum / windows : 0
}
