import type { Curve } from './curve'
import type { Recording } from './score'

// Seeded synthetic recordings for the score's own tests: a line of morae,
// each high or low, its pitch gliding between them, its features one
// sound per mora, so a take can differ from the native in exactly one way
// at a time. Imported only by tests.

export type SyntheticTake = Readonly<{
  // High or low per mora: the accent.
  pattern: ReadonlyArray<boolean>
  // Frames per mora, or one length for all.
  moraFrames: number | ReadonlyArray<number>
  registerHz: number
  // From low to high, in semitones.
  spanSemitones: number
  seed: number
  // Pitch jitter's size, in semitones.
  jitter?: number
  // Silence before and after the speech, in frames.
  leadFrames?: number
  tailFrames?: number
  // Each voiced frame's level, and the silence's.
  levelDb?: number
  silenceDb?: number
  // A colour every frame's features share, as a microphone or a voice
  // adds.
  colour?: number
}>

export const frameHz = 62.5
export const featureDims = 24

// mulberry32.
const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gaussian = (next: () => number): number =>
  Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next())

// The sound of the line's mora `index`: the same in every take of the
// line, whoever says it.
const soundOf = (index: number): Float64Array => {
  const next = random(9001 + index * 7919)
  return Float64Array.from({ length: featureDims }, () => 3 * gaussian(next))
}

export const syntheticTake = (take: SyntheticTake): Recording => {
  const lengths = take.pattern.map((_, k) =>
    typeof take.moraFrames === 'number'
      ? take.moraFrames
      : (take.moraFrames[k] ?? 0),
  )
  const lead = take.leadFrames ?? 20
  const tail = take.tailFrames ?? 20
  const speech = lengths.reduce((sum, length) => sum + length, 0)
  const frames = lead + speech + tail
  const next = random(take.seed)
  const f0Hz = new Float32Array(frames)
  const confidence = new Float32Array(frames)
  const levelDb = new Float32Array(frames).fill(take.silenceDb ?? -80)
  const data = new Float32Array(frames * featureDims)
  const colour = take.colour ?? 0

  for (let f = 0; f < frames; f++) {
    for (let d = 0; d < featureDims; d++) {
      data[f * featureDims + d] = colour * (d % 3) + 0.05 * gaussian(next)
    }
  }
  let f = lead
  let semitones = take.pattern[0] === true ? 0.5 : -0.5
  for (let k = 0; k < lengths.length; k++) {
    const sound = soundOf(k)
    const target = take.pattern[k] === true ? 0.5 : -0.5
    for (let step = 0; step < (lengths[k] ?? 0); step++, f++) {
      // A glide to each mora's level over about 50 ms.
      semitones += (target - semitones) * 0.3
      const st =
        semitones * take.spanSemitones + (take.jitter ?? 0.1) * gaussian(next)
      f0Hz[f] = take.registerHz * 2 ** (st / 12)
      confidence[f] = 0.9
      levelDb[f] = take.levelDb ?? -20
      for (let d = 0; d < featureDims; d++) {
        data[f * featureDims + d] =
          (sound[d] ?? 0) + colour * (d % 3) + 0.3 * gaussian(next)
      }
    }
  }

  const curve: Curve = {
    frameHz,
    f0Hz,
    confidence,
    levelDb,
    onsetFrame: lead,
  }
  return { curve, features: { frameHz, dims: featureDims, data } }
}

// The recording with its curve's pitch changed at each voiced frame.
export const withF0 = (
  recording: Recording,
  hzOf: (hz: number, frame: number) => number,
): Recording => ({
  ...recording,
  curve: {
    ...recording.curve,
    f0Hz: recording.curve.f0Hz.map((hz, frame) =>
      hz > 0 ? hzOf(hz, frame) : 0,
    ),
  },
})

// The recording with frames `from` to `to` unvoiced.
export const withGap = (
  recording: Recording,
  from: number,
  to: number,
): Recording => ({
  ...recording,
  curve: {
    ...recording.curve,
    f0Hz: recording.curve.f0Hz.map((hz, frame) =>
      frame >= from && frame < to ? 0 : hz,
    ),
    confidence: recording.curve.confidence.map((c, frame) =>
      frame >= from && frame < to ? 0 : c,
    ),
  },
})
