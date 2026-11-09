import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import {
  type SpectralOptions,
  spectralFeatures,
} from '../../src/engine/features/spectral.ts'
import { resample } from '../../src/engine/pitch/resample.ts'
import {
  type Aligner,
  type AlignmentPath,
  dtwAligner,
  normaliseFeatures,
  stretchAligner,
} from '../../src/score/align.ts'
import { fitPitch, pairPitch, tempoDeviation } from '../../src/score/compare.ts'
import { dtwBandSeconds, dtwBandShare } from '../../src/score/constants.ts'
import type { Curve } from '../../src/score/curve.ts'
import type { Features } from '../../src/score/features.ts'
import {
  type Recording,
  type ScoreDetail,
  scoreDetail,
} from '../../src/score/score.ts'
import { type PitchTrack, pitchTrack } from '../../src/score/track.ts'
import { root } from './run.ts'
import { readTracked } from './tracked-fixtures.ts'
import {
  type Condition,
  type Variant,
  conditions,
  fixtureId,
  phrases,
  voices,
} from './voice-fixture-set.ts'
import type { VoiceFixtureLabels } from './voice-fixtures.ts'

// The score's study on the VOICEVOX fixtures (docs/score.md): every
// voice's clean right take as the native, copied by every other voice in
// every variant and condition. scripts/score-study.ts writes its tables
// to docs/score-study.md, and the score's tests hold the score to what it
// found.

// A right accent, said at the voice's own pace, slower, faster or
// unevenly; and the two wrong accents. `mora-changed` keeps the accent and
// changes a sound, for ticket 20.
export const rightVariants = ['right', 'slower', 'faster', 'uneven'] as const
export const wrongVariants = ['fall-moved', 'fall-lost'] as const
export const studiedVariants: ReadonlyArray<Variant> = [
  ...rightVariants,
  'mora-changed',
  ...wrongVariants,
]
export const isWrong = (variant: Variant): boolean =>
  variant === 'fall-moved' || variant === 'fall-lost'

export type StudyFixture = Readonly<{
  id: string
  labels: VoiceFixtureLabels
  recording: Recording
  track: PitchTrack
}>

const fixtures = join(root, 'fixtures', 'voices')
const loaded = new Map<string, StudyFixture>()

export const studyFixture = (id: string): StudyFixture => {
  const known = loaded.get(id)
  if (known !== undefined) return known
  const tracked = readTracked(`voices/${id}`)
  if (tracked.curve === null) {
    throw new Error(`${id} was ${tracked.header.analysis}`)
  }
  const fixture = {
    id,
    labels: JSON.parse(readFileSync(join(fixtures, `${id}.json`), 'utf8')),
    recording: { curve: tracked.curve, features: tracked.features },
    track: pitchTrack(tracked.curve),
  }
  loaded.set(id, fixture)
  return fixture
}

export type StudyPair = Readonly<{
  phrase: string
  morae: number
  nativeVoice: string
  takeVoice: string
  variant: Variant
  condition: Condition
  native: StudyFixture
  take: StudyFixture
}>

// Every native and take, the take in another voice.
export const studyPairs = (
  variants: ReadonlyArray<Variant> = studiedVariants,
): ReadonlyArray<StudyPair> =>
  phrases.flatMap(phrase =>
    voices.flatMap(nativeVoice =>
      voices
        .filter(takeVoice => takeVoice.id !== nativeVoice.id)
        .flatMap(takeVoice =>
          conditions.flatMap(condition =>
            variants.map(variant => {
              const native = studyFixture(
                fixtureId(phrase.id, nativeVoice.id, 'right', 'clean'),
              )
              return {
                phrase: phrase.id,
                morae: native.labels.phrase.morae,
                nativeVoice: nativeVoice.id,
                takeVoice: takeVoice.id,
                variant,
                condition,
                native,
                take: studyFixture(
                  fixtureId(phrase.id, takeVoice.id, variant, condition),
                ),
              }
            }),
          ),
        ),
    ),
  )

// How each way of lining the take up finds its path, on the two speech
// spans.
export type StudyAligner = Readonly<{
  name: string
  path: (pair: StudyPair) => AlignmentPath | null
}>

const chosenDtw = dtwAligner({
  bandShare: dtwBandShare,
  bandSeconds: dtwBandSeconds,
  failDistance: Number.POSITIVE_INFINITY,
})

const onSpans =
  (aligner: Aligner, featuresOf: (fixture: StudyFixture) => Features) =>
  (pair: StudyPair) =>
    aligner.align(
      normaliseFeatures(
        featuresOf(pair.native),
        pair.native.track.from,
        pair.native.track.to,
      ),
      normaliseFeatures(
        featuresOf(pair.take),
        pair.take.track.from,
        pair.take.track.to,
      ),
    )

// The semitone track as a feature, a gap holding the last pitch: what
// DTW on pitch aligns.
export const pitchFeatures = (fixture: StudyFixture): Features => {
  const { semitones, voiced } = fixture.track
  const data = new Float32Array(semitones.length)
  let last = 0
  for (let f = 0; f < data.length; f++) {
    if (voiced[f] === 1) last = semitones[f] ?? 0
    data[f] = last
  }
  return { frameHz: fixture.track.frameHz, dims: 1, data }
}

const samples16k = new Map<string, Float32Array>()
const samplesOf = (fixture: StudyFixture): Float32Array => {
  const known = samples16k.get(fixture.id)
  if (known !== undefined) return known
  const wav = decodeWav(readFileSync(join(fixtures, `${fixture.id}.wav`)))
  const samples = resample(
    wav.channels[0] ?? new Float32Array(0),
    wav.sampleRate,
    16_000,
  )
  samples16k.set(fixture.id, samples)
  return samples
}

const otherFeatures = (options: SpectralOptions) => {
  const made = new Map<string, Features>()
  return (fixture: StudyFixture): Features => {
    const known = made.get(fixture.id)
    if (known !== undefined) return known
    const features = spectralFeatures(samplesOf(fixture), options)
    made.set(fixture.id, features)
    return features
  }
}

// Cepstra 1 to 12 of the log mel bands (the usual MFCCs, without the
// loudness in cepstrum 0).
export const cepstraOf = (features: Features, count = 12): Features => {
  const frames = features.data.length / features.dims
  const data = new Float32Array(frames * count)
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < count; c++) {
      let sum = 0
      for (let b = 0; b < features.dims; b++) {
        sum +=
          Math.cos((Math.PI * (c + 1) * (b + 0.5)) / features.dims) *
          (features.data[f * features.dims + b] ?? 0)
      }
      data[f * count + c] = sum
    }
  }
  return { frameHz: features.frameHz, dims: count, data }
}

// The take's frame for each native frame by the labelled mora
// boundaries, straight between them: the path a perfect aligner would
// find, as the ceiling.
export const labelledPath = (pair: StudyPair): AlignmentPath => {
  const boundaries = (fixture: StudyFixture) =>
    [
      ...fixture.labels.morae.map(mora => mora.startSample),
      fixture.labels.morae.at(-1)?.endSample ?? 0,
    ].map(
      sample =>
        (sample / fixture.labels.sampleRate) * fixture.track.frameHz -
        fixture.track.from,
    )
  const native = boundaries(pair.native)
  const take = boundaries(pair.take)
  const n = pair.native.track.to - pair.native.track.from
  const m = pair.take.track.to - pair.take.track.from
  const nativeFrames = new Int32Array(n)
  const takeFrames = new Int32Array(n)
  let k = 0
  for (let i = 0; i < n; i++) {
    while (k < native.length - 2 && i >= (native[k + 1] ?? 0)) k++
    const from = native[k] ?? 0
    const to = native[k + 1] ?? 1
    const at = (i - from) / (to - from)
    const j = (take[k] ?? 0) + at * ((take[k + 1] ?? 0) - (take[k] ?? 0))
    nativeFrames[i] = i
    takeFrames[i] = Math.max(0, Math.min(m - 1, Math.round(j)))
  }
  return { native: nativeFrames, take: takeFrames }
}

const chosenFeatures = (fixture: StudyFixture) => fixture.recording.features

export const studyAligners: ReadonlyArray<StudyAligner> = [
  {
    name: 'Stretch to the same length',
    path: onSpans(stretchAligner, chosenFeatures),
  },
  { name: 'DTW on pitch (control)', path: onSpans(chosenDtw, pitchFeatures) },
  {
    name: 'DTW on cepstra 1-12 of the chosen bands',
    path: onSpans(chosenDtw, fixture => cepstraOf(chosenFeatures(fixture))),
  },
  {
    name: 'DTW on 24 log mel bands, 300-3400 Hz',
    path: onSpans(
      chosenDtw,
      otherFeatures({ bands: 24, lowHz: 300, highHz: 3400 }),
    ),
  },
  {
    name: 'DTW on 40 log mel bands, 100-7600 Hz',
    path: onSpans(
      chosenDtw,
      otherFeatures({ bands: 40, lowHz: 100, highHz: 7600 }),
    ),
  },
  {
    name: 'DTW on 24 log mel bands, 100-7600 Hz (chosen)',
    path: onSpans(chosenDtw, chosenFeatures),
  },
  { name: 'Labelled mora boundaries (ceiling)', path: labelledPath },
]

// How far, in ms, the path puts each labelled mora boundary of the
// native from where it falls in the take.
export const boundaryErrors = (
  pair: StudyPair,
  path: AlignmentPath,
): ReadonlyArray<number> => {
  const n = pair.native.track.to - pair.native.track.from
  const sums = new Float64Array(n)
  const counts = new Float64Array(n)
  for (let k = 0; k < path.native.length; k++) {
    const i = path.native[k] ?? 0
    sums[i] = (sums[i] ?? 0) + (path.take[k] ?? 0)
    counts[i] = (counts[i] ?? 0) + 1
  }
  const frameOf = (fixture: StudyFixture, sample: number) =>
    (sample / fixture.labels.sampleRate) * fixture.track.frameHz
  const errors: Array<number> = []
  pair.native.labels.morae.forEach((mora, index) => {
    const i =
      Math.round(frameOf(pair.native, mora.startSample)) -
      pair.native.track.from
    const takeMora = pair.take.labels.morae[index]
    if (i < 0 || i >= n || takeMora === undefined || (counts[i] ?? 0) === 0)
      return
    const mapped = (sums[i] ?? 0) / (counts[i] ?? 1) + pair.take.track.from
    errors.push(
      (Math.abs(mapped - frameOf(pair.take, takeMora.startSample)) * 1000) /
        pair.native.track.frameHz,
    )
  })
  return errors
}

// The mean distance between the paired frames' normalised features along
// the chosen DTW's path: what the aligner's failure gate reads.
export const pathDistance = (
  native: StudyFixture,
  take: StudyFixture,
): number => {
  const a = normaliseFeatures(
    native.recording.features,
    native.track.from,
    native.track.to,
  )
  const b = normaliseFeatures(
    take.recording.features,
    take.track.from,
    take.track.to,
  )
  const path = chosenDtw.align(a, b)
  if (path === null) return Number.NaN
  let sum = 0
  for (let k = 0; k < path.native.length; k++) {
    let squares = 0
    for (let d = 0; d < a.dims; d++) {
      const step =
        (a.data[(path.native[k] ?? 0) * a.dims + d] ?? 0) -
        (b.data[(path.take[k] ?? 0) * a.dims + d] ?? 0)
      squares += step * step
    }
    sum += Math.sqrt(squares)
  }
  return sum / path.native.length
}

export const pitchSkillOf = (
  pair: StudyPair,
  path: AlignmentPath,
  band?: Readonly<{ least: number; most: number }>,
): number =>
  fitPitch(pairPitch(pair.native.track, pair.take.track, path), band).skill

export const tempoDeviationOf = (
  pair: StudyPair,
  path: AlignmentPath,
): number =>
  tempoDeviation(
    pair.native.track.to - pair.native.track.from,
    pair.take.track.to - pair.take.track.from,
    path,
    pair.native.track.frameHz,
  )

// The take with its pitch changed and all else kept, for the flat and
// timid takes: its curve's voiced frames moved to `hzOf(hz, median)`.
export const withPitch = (
  fixture: StudyFixture,
  hzOf: (hz: number, medianHz: number) => number,
): StudyFixture => {
  const voiced = Array.from(fixture.recording.curve.f0Hz)
    .filter(hz => hz > 0)
    .sort((a, b) => a - b)
  const medianHz = voiced[voiced.length >> 1] ?? 0
  const curve: Curve = {
    ...fixture.recording.curve,
    f0Hz: fixture.recording.curve.f0Hz.map(hz =>
      hz > 0 ? hzOf(hz, medianHz) : 0,
    ),
  }
  return {
    ...fixture,
    recording: { ...fixture.recording, curve },
    track: pitchTrack(curve),
  }
}

// One held note at the take's median: a monotone take.
export const flatTake = (fixture: StudyFixture): StudyFixture =>
  withPitch(fixture, (_, medianHz) => medianHz)

// The take's pitch movement scaled by `span` around its median.
export const spanScaled = (fixture: StudyFixture, span: number): StudyFixture =>
  withPitch(fixture, (hz, medianHz) => medianHz * (hz / medianHz) ** span)

export const scored = (pair: Pick<StudyPair, 'native' | 'take'>): ScoreDetail =>
  scoreDetail(pair.native.recording, pair.take.recording)

// The chance a value from `higher` beats one from `lower`, ties half.
export const chanceAbove = (
  higher: ReadonlyArray<number>,
  lower: ReadonlyArray<number>,
): number => {
  let wins = 0
  for (const a of higher)
    for (const b of lower) wins += a > b ? 1 : a === b ? 0.5 : 0
  return higher.length * lower.length === 0
    ? Number.NaN
    : wins / (higher.length * lower.length)
}

export const quantile = (values: ReadonlyArray<number>, q: number): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length === 0
    ? Number.NaN
    : (sorted[Math.round(q * (sorted.length - 1))] ?? Number.NaN)
}
export const median = (values: ReadonlyArray<number>): number =>
  quantile(values, 0.5)

// Spearman's rank correlation.
export const rankCorrelation = (
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number => {
  const ranks = (values: ReadonlyArray<number>) => {
    const order = values
      .map((value, index) => ({ value, index }))
      .sort((x, y) => x.value - y.value)
    const rank = new Array<number>(values.length).fill(0)
    order.forEach(({ index }, position) => {
      rank[index] = position
    })
    return rank
  }
  const ra = ranks(a)
  const rb = ranks(b)
  const mean = (values: ReadonlyArray<number>) =>
    values.reduce((s, v) => s + v, 0) / values.length
  const ma = mean(ra)
  const mb = mean(rb)
  let cross = 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < ra.length; i++) {
    const x = (ra[i] ?? 0) - ma
    const y = (rb[i] ?? 0) - mb
    cross += x * y
    sa += x * x
    sb += y * y
  }
  return cross / Math.sqrt(sa * sb)
}

// Each voice's measured pitch span, in semitones (fixtures/voices/voices.json).
const voiceList: ReadonlyArray<
  Readonly<{ id: string; spanSemitones: number }>
> = JSON.parse(readFileSync(join(fixtures, 'voices.json'), 'utf8'))
export const voiceSpans: ReadonlyMap<string, number> = new Map(
  voiceList.map(voice => [voice.id, voice.spanSemitones]),
)
