import { dtwAligner } from '../../src/score/align.ts'
import { dtwBandSeconds, dtwBandShare } from '../../src/score/constants.ts'
import { type Features, onCurveFrames } from '../../src/score/features.ts'
import {
  type StudyAligner,
  type StudyFixture,
  type StudyPair,
  chanceAbove,
  median,
  onSpans,
  studyFixture,
} from './score-study.ts'
import { readSoundFeatures } from './sound-features.ts'
import type { SoundFeatures, SoundModel } from './sound-models.ts'
import {
  type Condition,
  conditions,
  fixtureId,
  phrases,
  voices,
} from './voice-fixture-set.ts'

// The sounds study (docs/sounds.md): each model's frames over the speech,
// the cosine DTW distance between a native and a take, put on the scale
// the bar is read on, and the bar's four numbers.

// A model's frame k is centred this far into the recording: WavLM's
// convolutions read 400 samples every 320, Whisper's encoder halves the
// frames of a spectrogram centred on each 160th sample.
const frameCentreSeconds = (model: SoundModel, frame: number): number =>
  frame / model.frameHz + (model.input === 'samples' ? 200 / 16_000 : 0)

// The model's frames over the fixture's speech span (the score's own,
// `pitchTrack`), each scaled to length 1 for the cosine distance.
export const speechFrames = (
  model: SoundModel,
  fixture: StudyFixture,
): SoundFeatures => {
  const all = readSoundFeatures(model, fixture.id)
  const frames = all.data.length / all.dims
  const fromSeconds = fixture.track.from / fixture.track.frameHz
  const toSeconds = fixture.track.to / fixture.track.frameHz
  let from = 0
  while (from < frames && frameCentreSeconds(model, from) < fromSeconds) from++
  let to = from
  while (to < frames && frameCentreSeconds(model, to) < toSeconds) to++
  const data = all.data.slice(from * all.dims, to * all.dims)
  for (let f = 0; f < to - from; f++) {
    let squares = 0
    for (let d = 0; d < all.dims; d++)
      squares += (data[f * all.dims + d] ?? 0) ** 2
    const scale = squares > 0 ? 1 / Math.sqrt(squares) : 0
    for (let d = 0; d < all.dims; d++)
      data[f * all.dims + d] = (data[f * all.dims + d] ?? 0) * scale
  }
  return { frameHz: all.frameHz, dims: all.dims, data }
}

// DTW between two recordings' unit frames, each pair costing their cosine
// distance, in the score's band around the stretched diagonal; the path's
// cost over its length (McIntosh and colleagues' normalised distance).
export const cosineDtwDistance = (
  native: SoundFeatures,
  take: SoundFeatures,
): number => {
  const { dims } = native
  const n = native.data.length / dims
  const m = take.data.length / dims
  if (n < 2 || m < 2) return Number.NaN
  const band = Math.max(
    Math.ceil(dtwBandShare * Math.max(n, m)),
    Math.ceil(dtwBandSeconds * native.frameHz),
    Math.ceil(m / n) + 1,
  )
  const width = 2 * band + 1
  const centreOf = (i: number): number => Math.round((i * (m - 1)) / (n - 1))
  const cost = new Float64Array(n * width).fill(Number.POSITIVE_INFINITY)
  const steps = new Int32Array(n * width)
  const index = (i: number, j: number): number => {
    const k = j - centreOf(i) + band
    return i < 0 || j < 0 || k < 0 || k >= width ? -1 : i * width + k
  }
  for (let i = 0; i < n; i++) {
    const centre = centreOf(i)
    for (
      let j = Math.max(0, centre - band);
      j <= Math.min(m - 1, centre + band);
      j++
    ) {
      let dot = 0
      for (let d = 0; d < dims; d++) {
        dot += (native.data[i * dims + d] ?? 0) * (take.data[j * dims + d] ?? 0)
      }
      const distance = 1 - dot
      const here = index(i, j)
      if (i === 0 && j === 0) {
        cost[here] = distance
        steps[here] = 1
        continue
      }
      let best = Number.POSITIVE_INFINITY
      let bestSteps = 0
      for (const previous of [
        index(i - 1, j - 1),
        index(i - 1, j),
        index(i, j - 1),
      ]) {
        if (
          previous >= 0 &&
          (cost[previous] ?? Number.POSITIVE_INFINITY) < best
        ) {
          best = cost[previous] ?? Number.POSITIVE_INFINITY
          bestSteps = steps[previous] ?? 0
        }
      }
      cost[here] = best + distance
      steps[here] = bestSteps + 1
    }
  }
  const last = index(n - 1, m - 1)
  return last < 0 ? Number.NaN : (cost[last] ?? Number.NaN) / (steps[last] ?? 1)
}

const moraeOf = (phrase: string): number =>
  studyFixture(fixtureId(phrase, voices[0]?.id ?? '', 'right', 'clean')).labels
    .phrase.morae

export type SoundsPair = Readonly<{
  phrase: string
  morae: number
  nativeVoice: string
  takeVoice: string
  variant: 'right' | 'mora-changed'
  condition: Condition
  distance: number
}>

// Every native (each voice's clean right take) and the other voices'
// right and mora-changed takes, in every condition.
export const soundsPairs = (model: SoundModel): ReadonlyArray<SoundsPair> => {
  const frames = new Map<string, SoundFeatures>()
  const framesOf = (id: string) => {
    const known = frames.get(id)
    if (known !== undefined) return known
    const made = speechFrames(model, studyFixture(id))
    frames.set(id, made)
    return made
  }
  return phrases.flatMap(phrase =>
    voices.flatMap(nativeVoice =>
      voices
        .filter(takeVoice => takeVoice.id !== nativeVoice.id)
        .flatMap(takeVoice =>
          conditions.flatMap(condition =>
            (['right', 'mora-changed'] as const).map(variant => ({
              phrase: phrase.id,
              morae: moraeOf(phrase.id),
              nativeVoice: nativeVoice.id,
              takeVoice: takeVoice.id,
              variant,
              condition,
              distance: cosineDtwDistance(
                framesOf(
                  fixtureId(phrase.id, nativeVoice.id, 'right', 'clean'),
                ),
                framesOf(
                  fixtureId(phrase.id, takeVoice.id, variant, condition),
                ),
              ),
            })),
          ),
        ),
    ),
  )
}

// Takes of other words: each phrase's clean right take as the native,
// another phrase's clean right take in another voice as the take.
export const otherWordsDistances = (model: SoundModel): ReadonlyArray<number> =>
  phrases.flatMap(native =>
    phrases
      .filter(take => take.id !== native.id)
      .flatMap(take =>
        voices.flatMap(nativeVoice =>
          voices
            .filter(takeVoice => takeVoice.id !== nativeVoice.id)
            .map(takeVoice =>
              cosineDtwDistance(
                speechFrames(
                  model,
                  studyFixture(
                    fixtureId(native.id, nativeVoice.id, 'right', 'clean'),
                  ),
                ),
                speechFrames(
                  model,
                  studyFixture(
                    fixtureId(take.id, takeVoice.id, 'right', 'clean'),
                  ),
                ),
              ),
            ),
        ),
      ),
  )

export type SoundsScale = Readonly<{ top: number; zero: number }>

export const soundsScaleOf = (
  pairs: ReadonlyArray<SoundsPair>,
  otherWords: ReadonlyArray<number>,
): SoundsScale => ({
  top: median(
    pairs
      .filter(pair => pair.variant === 'right' && pair.condition === 'clean')
      .map(pair => pair.distance),
  ),
  zero: median(otherWords),
})

export const soundsPart = (scale: SoundsScale, distance: number): number =>
  Math.min(1, Math.max(0, (scale.zero - distance) / (scale.zero - scale.top)))

export type BarRow = Readonly<{
  phrase: string
  morae: number
  condition: Condition
  spreadMedian: number
  spreadWorst: number
  sameVoice: number
  acrossVoices: number
  // The same two chances on the raw distance, a shorter one higher,
  // before the scale clamps the closest takes to 1: not the bar's.
  sameVoiceRaw: number
  acrossVoicesRaw: number
  rightMedian: number
  changedMedian: number
}>

// The bar's first three numbers for each phrase and condition.
export const barRows = (
  pairs: ReadonlyArray<SoundsPair>,
  scale: SoundsScale,
): ReadonlyArray<BarRow> =>
  phrases.flatMap(phrase =>
    conditions.map(condition => {
      const own = pairs.filter(
        pair => pair.phrase === phrase.id && pair.condition === condition,
      )
      const part = (pair: SoundsPair) => soundsPart(scale, pair.distance)
      const spreads: Array<number> = []
      for (const nativeVoice of voices) {
        const rightParts = own
          .filter(
            pair =>
              pair.nativeVoice === nativeVoice.id && pair.variant === 'right',
          )
          .map(part)
        if (rightParts.length > 0) {
          spreads.push(Math.max(...rightParts) - Math.min(...rightParts))
        }
      }
      // The chance a right take is above a mora-changed one by `value`, in
      // the same take voice, and in any voice, for each native.
      const chances = (value: (pair: SoundsPair) => number) => {
        let wins = 0
        let comparisons = 0
        let sameWins = 0
        let sameComparisons = 0
        for (const nativeVoice of voices) {
          const native = own.filter(pair => pair.nativeVoice === nativeVoice.id)
          const right = native.filter(pair => pair.variant === 'right')
          const changed = native.filter(pair => pair.variant === 'mora-changed')
          wins +=
            chanceAbove(right.map(value), changed.map(value)) *
            right.length *
            changed.length
          comparisons += right.length * changed.length
          for (const take of right) {
            const twin = changed.find(pair => pair.takeVoice === take.takeVoice)
            if (twin === undefined) continue
            sameWins += chanceAbove([value(take)], [value(twin)])
            sameComparisons += 1
          }
        }
        return { same: sameWins / sameComparisons, across: wins / comparisons }
      }
      const onParts = chances(part)
      const onDistances = chances(pair => -pair.distance)
      return {
        phrase: phrase.id,
        morae: moraeOf(phrase.id),
        condition,
        spreadMedian: median(spreads),
        spreadWorst: Math.max(...spreads),
        sameVoice: onParts.same,
        acrossVoices: onParts.across,
        sameVoiceRaw: onDistances.same,
        acrossVoicesRaw: onDistances.across,
        rightMedian: median(
          own.filter(pair => pair.variant === 'right').map(part),
        ),
        changedMedian: median(
          own.filter(pair => pair.variant === 'mora-changed').map(part),
        ),
      }
    }),
  )

// The bar's first three conditions on its rows (docs/sounds.md).
export const barVerdict = (
  rows: ReadonlyArray<BarRow>,
): Readonly<{ level: boolean; sameVoice: boolean; acrossVoices: boolean }> => ({
  level: rows.every(row => row.spreadMedian <= 0.25 && row.spreadWorst <= 0.55),
  sameVoice: rows.every(row => row.sameVoice >= 0.95),
  acrossVoices: rows.every(
    row => row.acrossVoices >= (row.condition === 'clean' ? 0.9 : 0.8),
  ),
})

// The model's frames on the curve's own frames, through `onCurveFrames`:
// what the `Aligner` interface takes in place of the log mel bands.
export const modelFeaturesOnCurve = (
  model: SoundModel,
  fixture: StudyFixture,
): Features =>
  onCurveFrames(
    readSoundFeatures(model, fixture.id),
    frameCentreSeconds(model, 0),
    fixture.track.frameHz,
    fixture.recording.curve.f0Hz.length,
  )

const chosenDtw = dtwAligner({
  bandShare: dtwBandShare,
  bandSeconds: dtwBandSeconds,
  failDistance: Number.POSITIVE_INFINITY,
})

// The model's frames as the score's aligner reads features: normalised
// per take over its speech, then the chosen DTW, as ticket 10 compared
// the log mel bands.
export const modelAligner = (model: SoundModel): StudyAligner => {
  const made = new Map<string, Features>()
  const featuresOf = (fixture: StudyFixture) => {
    const known = made.get(fixture.id)
    if (known !== undefined) return known
    const features = modelFeaturesOnCurve(model, fixture)
    made.set(fixture.id, features)
    return features
  }
  return {
    name: `DTW on ${model.name}'s last layer`,
    path: (pair: StudyPair) => onSpans(chosenDtw, featuresOf)(pair),
  }
}
