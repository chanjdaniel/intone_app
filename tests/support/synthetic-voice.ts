// A synthetic voice with an exactly known pitch: a glottal pulse train
// whose instantaneous frequency follows a set F0 curve, through vowel
// formant filters, with a little seeded breath noise. No corpus data goes
// in, and the same name, rate and seed give the same samples every run.
//
// The fake microphone's tests play these (docs/fake-microphone.md), and
// `npm run fixtures:synthetic` writes them to fixtures/synthetic/.

export const voiceNames = ['low', 'middle', 'high'] as const
export type VoiceName = (typeof voiceNames)[number]

// One curve frame every 16 ms, as SwiftF0 tracks (CONTEXT.md, Curve).
export const frameHz = 62.5

export type SyntheticVoiceLabels = Readonly<{
  name: VoiceName
  seed: number
  sampleRate: number
  durationSeconds: number
  frameHz: number
  // Voiced stretches, [start, end) in seconds from the file's first sample.
  voiced: ReadonlyArray<readonly [number, number]>
  // The exact F0 at each frame's instant, k / frameHz, or null when
  // unvoiced.
  f0Hz: ReadonlyArray<number | null>
}>

type Voice = Readonly<{
  seed: number
  // F0 at the phrase's start; the contour moves between 0.8 and 1.25
  // times it, about 7.7 semitones, a speaker's usual accent span.
  baseHz: number
  // Vocal tract length: formants scale up for shorter tracts.
  formantScale: number
}>

const voices: Readonly<Record<VoiceName, Voice>> = {
  low: { seed: 20261101, baseHz: 100, formantScale: 1 },
  middle: { seed: 20261102, baseHz: 180, formantScale: 1.12 },
  high: { seed: 20261103, baseHz: 320, formantScale: 1.2 },
}

// Half a second of silence first, so audio the microphone path drops at
// its start is silence, then two voiced stretches split by a 60 ms stop
// closure, then silence to the end.
const durationSeconds = 2.3
const phrases = [
  { start: 0.5, end: 1.1, vowels: ['a', 'e'] },
  { start: 1.16, end: 1.9, vowels: ['o', 'u'] },
] as const

// F1 to F4 in Hz for an adult male tract, and their bandwidths.
type Vowel = 'a' | 'e' | 'i' | 'o' | 'u'
const formants: Readonly<Record<Vowel, readonly number[]>> = {
  a: [730, 1090, 2440, 3400],
  e: [530, 1840, 2480, 3500],
  i: [270, 2290, 3010, 3700],
  o: [570, 840, 2410, 3400],
  u: [300, 870, 2240, 3300],
}
const bandwidths = [60, 90, 120, 150]

const rampSeconds = 0.025
const breath = 0.03
const peak = 0.5

const smoothstep = (x: number): number => {
  const clamped = Math.min(1, Math.max(0, x))
  return clamped * clamped * (3 - 2 * clamped)
}

const lerp = (from: number, to: number, x: number): number =>
  from + (to - from) * x

// The F0 contour, as a ratio of the voice's base: a rise to a high, an
// accent fall at the end of the first stretch, then a low that declines.
const contour = (t: number): number => {
  if (t < 1.13) {
    return t < 0.85
      ? lerp(1, 1.25, smoothstep((t - 0.5) / 0.25))
      : lerp(1.25, 0.9, smoothstep((t - 0.85) / 0.25))
  }
  return lerp(0.9, 0.8, (t - 1.16) / 0.74)
}

const phraseAt = (t: number) =>
  phrases.find(phrase => t >= phrase.start && t < phrase.end)

export const f0At = (name: VoiceName, t: number): number | null =>
  phraseAt(t) === undefined ? null : voices[name].baseHz * contour(t)

// mulberry32: a small seeded generator, uniform in [0, 1).
const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let x = state
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// The Rosenberg glottal flow pulse, by phase in the period: opening for
// 40% of it, closing for 16%, then closed.
const glottalFlow = (phase: number): number => {
  const opening = 0.4
  const closing = 0.16
  if (phase < opening) {
    return 0.5 * (1 - Math.cos((Math.PI * phase) / opening))
  }
  if (phase < opening + closing) {
    return Math.cos((Math.PI * (phase - opening)) / (2 * closing))
  }
  return 0
}

const envelopeAt = (t: number): number => {
  const phrase = phraseAt(t)
  if (phrase === undefined) {
    return 0
  }
  const edge = Math.min(t - phrase.start, phrase.end - t)
  return edge >= rampSeconds
    ? 1
    : 0.5 * (1 - Math.cos((Math.PI * edge) / rampSeconds))
}

export const synthesiseVoice = (
  name: VoiceName,
  sampleRate: number,
): Readonly<{ samples: Float32Array; labels: SyntheticVoiceLabels }> => {
  const voice = voices[name]
  const length = Math.round(durationSeconds * sampleRate)
  const noise = random(voice.seed)
  const signal = new Float64Array(length)
  // Two-pole resonator state per formant (Klatt's cascade).
  const previous = [0, 0, 0, 0]
  const beforePrevious = [0, 0, 0, 0]
  let phase = 0
  let lastOutput = 0
  let lastFiltered = 0

  for (let n = 0; n < length; n++) {
    const t = n / sampleRate
    const phrase = phraseAt(t)
    const f0 = f0At(name, t)
    let source = 0
    if (phrase === undefined || f0 === null) {
      phase = 0
    } else {
      source = envelopeAt(t) * (glottalFlow(phase) + breath * (2 * noise() - 1))
      phase = (phase + f0 / sampleRate) % 1
    }
    const progress =
      phrase === undefined
        ? 0
        : (t - phrase.start) / (phrase.end - phrase.start)
    let x = source
    for (let k = 0; k < 4; k++) {
      const from = formants[phrase?.vowels[0] ?? 'a'][k] ?? 0
      const to = formants[phrase?.vowels[1] ?? 'a'][k] ?? 0
      const frequency = lerp(from, to, progress) * voice.formantScale
      const bandwidth = bandwidths[k] ?? 0
      const c = -Math.exp((-2 * Math.PI * bandwidth) / sampleRate)
      const b =
        2 *
        Math.exp((-Math.PI * bandwidth) / sampleRate) *
        Math.cos((2 * Math.PI * frequency) / sampleRate)
      const a = 1 - b - c
      const y = a * x + b * (previous[k] ?? 0) + c * (beforePrevious[k] ?? 0)
      beforePrevious[k] = previous[k] ?? 0
      previous[k] = y
      x = y
    }
    // Radiation at the lips: a first difference.
    lastOutput = x - lastFiltered
    lastFiltered = x
    signal[n] = lastOutput
  }

  let loudest = 0
  for (const sample of signal) {
    loudest = Math.max(loudest, Math.abs(sample))
  }
  const samples = Float32Array.from(signal, sample => (sample * peak) / loudest)

  const frames = Math.floor(durationSeconds * frameHz)
  const round = (hz: number): number => Math.round(hz * 1000) / 1000
  return {
    samples,
    labels: {
      name,
      seed: voice.seed,
      sampleRate,
      durationSeconds,
      frameHz,
      voiced: phrases.map(({ start, end }) => [start, end] as const),
      f0Hz: Array.from({ length: frames }, (_, k) => {
        const f0 = f0At(name, k / frameHz)
        return f0 === null ? null : round(f0)
      }),
    },
  }
}

// The voiced frames at least `margin` seconds from a voicing edge, where a
// pitch estimate's window holds voice only.
export const voicedFramesAwayFromEdges = (
  labels: SyntheticVoiceLabels,
  margin = 0.04,
): ReadonlyArray<number> =>
  labels.f0Hz.flatMap((hz, frame) => {
    const t = frame / labels.frameHz
    return hz !== null &&
      labels.voiced.some(
        ([start, end]) => t >= start + margin && t < end - margin,
      )
      ? [frame]
      : []
  })
