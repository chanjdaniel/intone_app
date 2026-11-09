import { sileroWindow } from './silero'

// How far a line's native curve can be trusted, from two measures, each
// pairing SwiftF0's frames with Silero VAD's windows over the same audio
// (report section 2: background music is the real limit, since SwiftF0
// reports any pitched sound):
//
// - the share of the line's speech where SwiftF0 found a confident pitch:
//   low when noise, a crowd or a hard voice hides it, and then the curve
//   has holes, and a take is compared on fewer frames;
// - the share of the line's pauses, where Silero hears no speech, that
//   still have a confident pitch: high when music, a hum or another voice
//   runs under the line, and then its curve may follow that sound.
//
// The thresholds are in `qualityRules`, each naming what it was set from
// (docs/cut-study.md measures them on the CC0 clips, clean, with room
// noise and with music under them).

// SwiftF0's hop: 256 samples, 16 ms at 16 kHz.
const frameSamples = 256

export type LineQuality = Readonly<{
  // Frames in the line's speech, and the share of them with a pitch.
  speechFrames: number
  confidentShare: number
  // Frames in the line's pauses, away from its speech, and the share of
  // them with a pitch.
  pauseFrames: number
  pausePitchedShare: number
}>

export type QualityRules = Readonly<{
  // A window at or over this is speech, as the cut says (./lines.ts).
  speechThreshold: number
  // A window under this is a pause, as the cut says.
  pauseThreshold: number
  // Pause frames this close to speech are left out: SwiftF0's frame and
  // Silero's window each smear the voice's edge by a few tens of ms.
  pauseMarginSeconds: number
  // Under this many speech frames, or pause frames, the share says too
  // little to mark anything.
  fewestSpeechFrames: number
  fewestPauseFrames: number
  // Under this share of confident speech the line is marked.
  lowConfidentShare: number
  // Over this share of pitched pauses, most of them, the line is marked.
  musicPausePitchedShare: number
}>

export const qualityRules: QualityRules = {
  speechThreshold: 0.5,
  pauseThreshold: 0.35,
  // Two Silero windows, 64 ms.
  pauseMarginSeconds: 0.064,
  // 256 ms, the shortest speech a cut keeps.
  fewestSpeechFrames: 16,
  // 128 ms: a line keeps 150 ms of quiet before it and 200 ms after.
  fewestPauseFrames: 8,
  // The CC0 readings' lines have 0.50 or more clean, and 0.48 or more
  // under the classroom noise at 8 dB below them, the most noise that
  // still leaves them most of their curves (docs/cut-study.md): under 0.4
  // is well below every one.
  lowConfidentShare: 0.4,
  // "Most", as ticket 14 words it: the CC0 readings' pauses have no
  // pitch clean and at most 0.10 under the classroom noise, while under
  // the music bed (tests/support/music-bed.ts) at 15 dB below the speech
  // 24 of the 35 lines left a curve go over a half (docs/cut-study.md).
  musicPausePitchedShare: 0.5,
}

// The quality of a line of the clip from sample `lineFrom`, whose curve's
// gated pitch is `f0Hz` (0 where none), against Silero's probabilities
// for windows of 512 samples from sample `probabilitiesFrom` of the clip.
export const lineQuality = (
  f0Hz: Float32Array,
  lineFrom: number,
  probabilities: ArrayLike<number>,
  probabilitiesFrom = 0,
  rules: QualityRules = qualityRules,
): LineQuality => {
  const windowAt = (sample: number): number =>
    Math.floor((sample - probabilitiesFrom) / sileroWindow)
  const probabilityOf = (window: number): number =>
    window >= 0 && window < probabilities.length
      ? (probabilities[window] ?? 0)
      : 0
  const margin = Math.ceil((rules.pauseMarginSeconds * 16_000) / sileroWindow)
  const nearSpeech = (window: number): boolean => {
    for (let k = window - margin; k <= window + margin; k += 1) {
      if (probabilityOf(k) >= rules.speechThreshold) {
        return true
      }
    }
    return false
  }
  let speechFrames = 0
  let confident = 0
  let pauseFrames = 0
  let pitched = 0
  for (let frame = 0; frame < f0Hz.length; frame += 1) {
    const window = windowAt(lineFrom + frame * frameSamples)
    const probability = probabilityOf(window)
    const voiced = (f0Hz[frame] ?? 0) > 0
    if (probability >= rules.speechThreshold) {
      speechFrames += 1
      confident += voiced ? 1 : 0
    } else if (probability < rules.pauseThreshold && !nearSpeech(window)) {
      pauseFrames += 1
      pitched += voiced ? 1 : 0
    }
  }
  return {
    speechFrames,
    confidentShare: speechFrames === 0 ? 0 : confident / speechFrames,
    pauseFrames,
    pausePitchedShare: pauseFrames === 0 ? 0 : pitched / pauseFrames,
  }
}

export type LineMarks = Readonly<{
  lowConfidence: boolean
  likelyMusic: boolean
}>

export const lineMarks = (
  quality: LineQuality,
  rules: QualityRules = qualityRules,
): LineMarks => ({
  lowConfidence:
    quality.speechFrames >= rules.fewestSpeechFrames &&
    quality.confidentShare < rules.lowConfidentShare,
  likelyMusic:
    quality.pauseFrames >= rules.fewestPauseFrames &&
    quality.pausePitchedShare > rules.musicPausePitchedShare,
})
