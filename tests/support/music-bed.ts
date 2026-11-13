import { random, seedOf } from './random.ts'

// A stand-in for background music under a line, made from a seed: four
// held chord tones that change every second and a melody note every
// quarter second, each with six harmonics falling away, so it is pitched
// throughout, as a score under drama or anime audio is. It is not real
// music (nothing licensed is in the repository), only what SwiftF0 hears
// in it: a strong, steady pitch where no one is speaking. The cut study
// (docs/cut-study.md) and the tracker tests mix it under the CC0
// readings to set and hold the "likely music" mark
// (src/engine/cut/quality.ts).

const rate = 16_000

// Semitones above A2 (110 Hz) of a few plain chords, and the melody's
// notes over them.
const chords = [
  [0, 4, 7, 12],
  [5, 9, 12, 17],
  [7, 11, 14, 19],
  [-3, 0, 4, 9],
] as const
const melody = [24, 26, 28, 31, 33, 31, 28, 26] as const

const hzOf = (semitones: number): number => 110 * 2 ** (semitones / 12)

const tone = (hz: number, time: number): number => {
  let value = 0
  for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
    value += Math.sin(2 * Math.PI * hz * harmonic * time) / harmonic ** 1.5
  }
  return value
}

// `seconds` of the bed at 16 kHz, at RMS `rms`.
export const musicBed = (
  seconds: number,
  rms: number,
  seed = 'music-bed',
): Float32Array => {
  const next = random(seedOf(seed))
  const chordOrder = Array.from({ length: Math.ceil(seconds) + 1 }, () =>
    Math.floor(next() * chords.length),
  )
  const melodyOrder = Array.from({ length: Math.ceil(seconds * 4) + 1 }, () =>
    Math.floor(next() * melody.length),
  )
  const samples = new Float32Array(Math.round(seconds * rate))
  for (let n = 0; n < samples.length; n += 1) {
    const time = n / rate
    const chord = chords[chordOrder[Math.floor(time)] ?? 0] ?? chords[0]
    const note = melody[melodyOrder[Math.floor(time * 4)] ?? 0] ?? melody[0]
    let value = tone(hzOf(note), time)
    for (const semitones of chord) {
      value += 0.5 * tone(hzOf(semitones), time)
    }
    samples[n] = value
  }
  let sum = 0
  for (const sample of samples) {
    sum += sample * sample
  }
  const gain = rms / Math.sqrt(sum / Math.max(1, samples.length))
  return samples.map(sample => sample * gain)
}

// The RMS of the stretches of `samples` where `voiced` holds.
export const rmsWhere = (
  samples: Float32Array,
  voiced: (sample: number) => boolean,
): number => {
  let sum = 0
  let count = 0
  for (let n = 0; n < samples.length; n += 1) {
    if (voiced(n)) {
      sum += (samples[n] ?? 0) ** 2
      count += 1
    }
  }
  return Math.sqrt(sum / Math.max(1, count))
}

// `under` added beneath `speech`, both at 16 kHz.
export const mixUnder = (
  speech: Float32Array,
  under: Float32Array,
): Float32Array => speech.map((sample, n) => sample + (under[n] ?? 0))
