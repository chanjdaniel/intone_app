// How each VOICEVOX fixture is made from its query, how its labels are
// read off the query, and how its room-noise and phone versions are made
// from it. scripts/voice-fixtures.ts runs these; the tests read the
// labels they write (fixtures/README.md says what each field means).

import { type Span, mixNoise, phoneBand, phoneBandHz } from './fixture-audio.ts'
import { estimatePitch } from './pitch.ts'
import { random, seedOf } from './random.ts'
import {
  type Condition,
  type Phrase,
  type Variant,
  type Voice,
  fasterSpeedScale,
  fixtureId,
  roomSnrDb,
  slowerSpeedScale,
} from './voice-fixture-set.ts'
import {
  type AudioQuery,
  frameRate,
  samplesPerFrame,
  timelineOf,
  voicevoxSampleRate,
} from './voicevox-query.ts'

// Silence before and after the speech, long enough that a microphone path
// that drops its first tens of milliseconds drops silence
// (docs/fake-microphone.md).
export const leadSeconds = 0.3
export const tailSeconds = 0.3

export const kanaOf = (phrase: Phrase, variant: Variant): string => {
  switch (variant) {
    case 'fall-moved':
      return phrase.fallMoved
    case 'fall-lost':
      return phrase.fallLost
    case 'mora-changed':
      return phrase.moraChanged
    default:
      return phrase.right
  }
}

// An uneven take holds about a third of its morae half again as long and
// clips about a quarter to six tenths, seeded by the fixture, so the
// overall tempo stays near the voice's own.
const heldScale = 1.6
const clippedScale = 0.6

export const unevenScales = (
  id: string,
  morae: number,
): ReadonlyArray<number> => {
  const next = random(seedOf(id))
  const scales = Array.from({ length: morae }, () => {
    const draw = next()
    return draw < 0.35 ? heldScale : draw > 0.75 ? clippedScale : 1
  })
  // At least one of each, so every uneven fixture is uneven both ways.
  if (!scales.includes(heldScale)) scales[0] = heldScale
  if (!scales.includes(clippedScale)) scales[morae - 1] = clippedScale
  return scales
}

const f32 = Math.fround

const quantile = (sorted: ReadonlyArray<number>, q: number): number =>
  sorted[Math.round(q * (sorted.length - 1))] ?? Number.NaN

// A voice's own pitch levels in log Hz, read off VOICEVOX's predictions
// for its right accents: the 10th and 90th percentile of its voiced morae.
export type PitchLevels = Readonly<{ low: number; high: number }>

export const pitchLevelsOf = (
  queries: ReadonlyArray<AudioQuery>,
): PitchLevels => {
  const voiced = queries
    .flatMap(query => query.accent_phrases.flatMap(p => p.moras))
    .map(mora => mora.pitch)
    .filter(pitch => pitch > 0)
    .sort((a, b) => a - b)
  return { low: quantile(voiced, 0.1), high: quantile(voiced, 0.9) }
}

// VOICEVOX predicts each mora's pitch from the accent, but softly: on
// these phrases its atamadaka often puts the second mora above the first,
// and a moved or lost fall changes a mora by a semitone or two. So each
// fixture's mora pitches are set from its kana's accent instead, in the
// Tokyo pattern, between the voice's own levels, and only the timbre and
// the timing are VOICEVOX's predictions:
//
// - a phrase that falls after its first mora starts high and is low after;
// - any other starts halfway up, is high to its fall, and low after it,
//   or high to its end when it does not fall;
// - each fall lowers the next phrase's top (downstep), and a pause resets
//   it;
// - the pitch declines a little mora by mora.
const initialRise = 0.5
const downstep = 0.7
const declinationPerMora = 0.01

export const accentPitches = (
  query: AudioQuery,
  levels: PitchLevels,
): AudioQuery => {
  let span = levels.high - levels.low
  let k = 0
  return {
    ...query,
    accent_phrases: query.accent_phrases.map(phrase => {
      const morae = phrase.moras.length
      const fall = phrase.accent === morae ? null : phrase.accent
      const top = levels.low + span
      const moras = phrase.moras.map((mora, index) => {
        const place = index + 1
        const level =
          fall === 1
            ? place === 1
              ? top
              : levels.low
            : place === 1
              ? levels.low + initialRise * span
              : fall === null || place <= fall
                ? top
                : levels.low
        const pitch = level - declinationPerMora * k++
        return { ...mora, pitch: mora.pitch > 0 ? f32(pitch) : mora.pitch }
      })
      span =
        phrase.pause_mora !== null
          ? levels.high - levels.low
          : fall === null
            ? span
            : span * downstep
      return { ...phrase, moras }
    }),
  }
}

// The query a variant is synthesised from: VOICEVOX's own for the kana,
// with its mora pitches set from the accent, the lead and tail silence,
// and the variant's speed or mora lengths. Every number is a 32-bit
// float, as VOICEVOX CORE reads it.
export const editQuery = (
  query: AudioQuery,
  variant: Variant,
  id: string,
  levels: PitchLevels,
): AudioQuery => {
  const morae = query.accent_phrases.reduce((sum, p) => sum + p.moras.length, 0)
  const scales =
    variant === 'uneven'
      ? unevenScales(id, morae)
      : Array<number>(morae).fill(1)
  let k = 0
  const pitched = accentPitches(query, levels)
  return {
    ...pitched,
    speed_scale: f32(
      variant === 'slower'
        ? slowerSpeedScale
        : variant === 'faster'
          ? fasterSpeedScale
          : 1,
    ),
    pre_phoneme_length: f32(leadSeconds),
    post_phoneme_length: f32(tailSeconds),
    accent_phrases: pitched.accent_phrases.map(phrase => ({
      ...phrase,
      moras: phrase.moras.map(mora => ({
        ...mora,
        vowel_length: f32(mora.vowel_length * (scales[k++] ?? 1)),
      })),
    })),
  }
}

export type LabelledMora = Readonly<{
  text: string
  // Its accent phrase, from 0.
  phrase: number
  devoiced: boolean
  // The mora's sound differs from the right one (the mora-changed variant).
  changed: boolean
  // How much longer its vowel is than VOICEVOX's own (the uneven variant).
  vowelLengthScale: number
  // Sample indices at 24 kHz: start, vowel start, end (exclusive).
  startSample: number
  vowelSample: number
  endSample: number
  startSeconds: number
  endSeconds: number
  // The pitch the synthesiser was given for the mora, in Hz, or null.
  targetHz: number | null
}>

export type LabelledAccentPhrase = Readonly<{
  kana: string
  morae: number
  // VOICEVOX's accent: the last high mora, from 1.
  accent: number
  // The mora the pitch falls after, from 1, or null when it does not
  // fall inside the phrase.
  fallAfter: number | null
  rightFallAfter: number | null
  pauseAfter: boolean
}>

export type VoiceFixtureLabels = Readonly<{
  id: string
  phrase: Readonly<{ id: string; text: string; reading: string; morae: number }>
  voice: Readonly<{ id: string; name: string; styleId: number; credit: string }>
  variant: Variant
  condition: Condition
  // What makes the variant wrong, or null for the right accent.
  wrong: string | null
  kana: string
  speedScale: number
  sampleRate: number
  samples: number
  durationSeconds: number
  // VOICEVOX's frames: each mora's boundaries fall on one.
  frameRate: number
  speechStartSample: number
  speechEndSample: number
  accentPhrases: ReadonlyArray<LabelledAccentPhrase>
  morae: ReadonlyArray<LabelledMora>
  // For the room and phone versions: what was done to the clean one.
  noise: Readonly<{
    source: string
    snrDb: number
    offsetSample: number
    gain: number
  }> | null
  band: Readonly<{ lowHz: number; highHz: number; order: number }> | null
}>

const seconds = (sample: number): number =>
  Math.round((sample / voicevoxSampleRate) * 1e6) / 1e6

const hz = (value: number): number => Math.round(value * 100) / 100

const kanaPhrases = (
  kana: string,
): ReadonlyArray<{ kana: string; pauseAfter: boolean }> => {
  const parts: Array<{ kana: string; pauseAfter: boolean }> = []
  let current = ''
  for (const letter of kana) {
    if (letter === '/' || letter === '、') {
      parts.push({ kana: current, pauseAfter: letter === '、' })
      current = ''
    } else {
      current += letter
    }
  }
  parts.push({ kana: current, pauseAfter: false })
  return parts
}

const fallAfter = (accent: number, morae: number): number | null =>
  accent === morae ? null : accent

export const labelsOf = ({
  phrase,
  voice,
  variant,
  query,
  rightQuery,
  samples,
}: Readonly<{
  phrase: Phrase
  voice: Voice
  variant: Variant
  // The query synthesised, and the right accent's from VOICEVOX.
  query: AudioQuery
  rightQuery: AudioQuery
  samples: number
}>): VoiceFixtureLabels => {
  const timeline = timelineOf(query)
  if (timeline.frames * samplesPerFrame !== samples) {
    throw new Error(
      `${fixtureId(phrase.id, voice.id, variant, 'clean')}: the query gives ${timeline.frames} frames, ${timeline.frames * samplesPerFrame} samples, and the WAV holds ${samples}.`,
    )
  }
  const kana = kanaOf(phrase, variant)
  const rightMorae = rightQuery.accent_phrases.flatMap(p => p.moras)
  const ownMorae = query.accent_phrases.flatMap(p => p.moras)
  const id = fixtureId(phrase.id, voice.id, variant, 'clean')
  const scales =
    variant === 'uneven'
      ? unevenScales(id, ownMorae.length)
      : ownMorae.map(() => 1)
  const parts = kanaPhrases(kana)
  return {
    id,
    phrase: {
      id: phrase.id,
      text: phrase.text,
      reading: phrase.reading,
      morae: ownMorae.length,
    },
    voice: {
      id: voice.id,
      name: voice.name,
      styleId: voice.styleId,
      credit: voice.credit,
    },
    variant,
    condition: 'clean',
    wrong:
      variant === 'fall-moved'
        ? phrase.changes.fallMoved
        : variant === 'fall-lost'
          ? phrase.changes.fallLost
          : variant === 'mora-changed'
            ? phrase.changes.moraChanged
            : null,
    kana,
    speedScale: query.speed_scale,
    sampleRate: voicevoxSampleRate,
    samples,
    durationSeconds: seconds(samples),
    frameRate,
    speechStartSample: timeline.speechFrom * samplesPerFrame,
    speechEndSample: timeline.speechTo * samplesPerFrame,
    accentPhrases: query.accent_phrases.map((p, k) => ({
      kana: parts[k]?.kana ?? '',
      morae: p.moras.length,
      accent: p.accent,
      fallAfter: fallAfter(p.accent, p.moras.length),
      rightFallAfter: fallAfter(
        rightQuery.accent_phrases[k]?.accent ?? 0,
        rightQuery.accent_phrases[k]?.moras.length ?? 0,
      ),
      pauseAfter: p.pause_mora !== null,
    })),
    morae: timeline.morae.map((mora, k) => ({
      text: mora.text,
      phrase: mora.phrase,
      devoiced: mora.devoiced,
      changed: mora.text !== rightMorae[k]?.text,
      vowelLengthScale: scales[k] ?? 1,
      startSample: mora.startFrame * samplesPerFrame,
      vowelSample: mora.vowelFrame * samplesPerFrame,
      endSample: mora.endFrame * samplesPerFrame,
      startSeconds: seconds(mora.startFrame * samplesPerFrame),
      endSeconds: seconds(mora.endFrame * samplesPerFrame),
      targetHz: mora.pitchHz === null ? null : hz(mora.pitchHz),
    })),
    noise: null,
    band: null,
  }
}

export const speechSpansOf = (
  labels: VoiceFixtureLabels,
): ReadonlyArray<Span> => [
  { from: labels.speechStartSample, to: labels.speechEndSample },
]

export const noiseSource = 'noise/classroom'

// The room or phone version of a clean fixture.
export const deriveCondition = (
  clean: Float32Array,
  labels: VoiceFixtureLabels,
  condition: Exclude<Condition, 'clean'>,
  noise: Float32Array,
): Readonly<{ samples: Float32Array; labels: VoiceFixtureLabels }> => {
  const id = fixtureId(
    labels.phrase.id,
    labels.voice.id,
    labels.variant,
    condition,
  )
  if (condition === 'phone') {
    return {
      samples: phoneBand(clean, labels.sampleRate),
      labels: {
        ...labels,
        id,
        condition,
        band: { lowHz: phoneBandHz.low, highHz: phoneBandHz.high, order: 4 },
      },
    }
  }
  const offsetSample = Math.floor(
    random(seedOf(id))() * (noise.length - clean.length),
  )
  const { samples, noiseGain } = mixNoise(clean, noise, {
    snrDb: roomSnrDb,
    offset: offsetSample,
    speechSpans: speechSpansOf(labels),
  })
  return {
    samples,
    labels: {
      ...labels,
      id,
      condition,
      noise: {
        source: noiseSource,
        snrDb: roomSnrDb,
        offsetSample,
        gain: Math.round(noiseGain * 1e6) / 1e6,
      },
    },
  }
}

export type VoiceSpan = Readonly<{
  id: string
  name: string
  // Measured on the voice's right-accent fixtures by YIN
  // (tests/support/pitch.ts), never the app's tracker: the median F0 and
  // the span from the 5th to the 95th percentile, in semitones.
  medianHz: number
  lowHz: number
  highHz: number
  spanSemitones: number
}>

// The F0 over a fixture's voiced morae, at 100 frames a second.
export const voicedPitchOf = (
  samples: Float32Array,
  labels: VoiceFixtureLabels,
): ReadonlyArray<number> => {
  const frameHz = 100
  const estimate = estimatePitch(samples, labels.sampleRate, frameHz)
  return labels.morae.flatMap(mora => {
    if (mora.targetHz === null) return []
    const from = Math.ceil((mora.vowelSample / labels.sampleRate) * frameHz)
    const to = Math.floor((mora.endSample / labels.sampleRate) * frameHz)
    const values: Array<number> = []
    for (let k = from; k < to; k++) {
      const value = estimate[k] ?? Number.NaN
      if (Number.isFinite(value)) values.push(value)
    }
    return values
  })
}

export const voiceSpanOf = (
  voice: Voice,
  pitches: ReadonlyArray<number>,
): VoiceSpan => {
  const sorted = [...pitches].sort((a, b) => a - b)
  const low = quantile(sorted, 0.05)
  const high = quantile(sorted, 0.95)
  return {
    id: voice.id,
    name: voice.name,
    medianHz: hz(quantile(sorted, 0.5)),
    lowHz: hz(low),
    highHz: hz(high),
    spanSemitones: Math.round(12 * Math.log2(high / low) * 100) / 100,
  }
}
