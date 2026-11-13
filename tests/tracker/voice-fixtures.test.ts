import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import { resample } from '../../src/engine/pitch/resample.ts'
import { analyseTake } from '../../src/engine/pitch/take.ts'
import { root } from '../support/run.ts'
import { loadSwiftF0Model, withSwiftF0 } from '../support/swift-f0.ts'
import { fixtureId, phrases, voices } from '../support/voice-fixture-set.ts'
import type {
  LabelledMora,
  VoiceFixtureLabels,
} from '../support/voice-fixtures.ts'

// The VOICEVOX fixtures sound as their labels say: tracked by the app's
// own tracker on the real SwiftF0 model, each right accent falls where its
// label puts the fall, and a lost fall holds there. The plain YIN estimate
// in tests/support/pitch.ts reads too few of VOICEVOX's frames for this
// (its vocoder's voice is less periodic over YIN's 25 ms window).

const fixtures = join(root, 'fixtures', 'voices')
let model: Uint8Array<ArrayBuffer> = new Uint8Array(0)

beforeAll(async () => {
  model = await loadSwiftF0Model()
})

const curveOf = async (id: string) => {
  const wav = decodeWav(readFileSync(join(fixtures, `${id}.wav`)))
  const samples = wav.channels[0] ?? new Float32Array(0)
  const analysis = await withSwiftF0(model, infer =>
    analyseTake(resample(samples, wav.sampleRate, 16_000), infer),
  )
  if (analysis._tag !== 'Tracked') {
    throw new Error(`${id}: ${analysis._tag}`)
  }
  return analysis.curve
}

// The median F0 over a mora, or NaN when the tracker voiced too little of
// it.
const moraHz = (
  f0Hz: Float32Array,
  frameHz: number,
  mora: LabelledMora,
  sampleRate: number,
): number => {
  const from = Math.ceil((mora.startSample / sampleRate) * frameHz)
  const to = Math.floor((mora.endSample / sampleRate) * frameHz)
  const voiced = Array.from(f0Hz.subarray(from, Math.max(from, to)))
    .filter(hz => hz > 0)
    .sort((a, b) => a - b)
  return voiced.length < 2
    ? Number.NaN
    : (voiced[Math.floor(voiced.length / 2)] ?? Number.NaN)
}

// Per accent phrase with a right-accent fall: how many semitones the
// lowest voiced mora after the fall sits below the mora before it.
const dropsAtRightFalls = async (
  id: string,
): Promise<
  ReadonlyArray<Readonly<{ phrase: number; falls: boolean; drop: number }>>
> => {
  const labels: VoiceFixtureLabels = JSON.parse(
    readFileSync(join(fixtures, `${id}.json`), 'utf8'),
  )
  const curve = await curveOf(id)
  const hz = (mora: LabelledMora) =>
    moraHz(curve.f0Hz, curve.frameHz, mora, labels.sampleRate)
  return labels.accentPhrases.flatMap((accentPhrase, k) => {
    const own = labels.morae.filter(mora => mora.phrase === k)
    const fall = accentPhrase.rightFallAfter
    if (fall === null) return []
    const before = own[fall - 1]
    const after = own.slice(fall).map(hz).filter(Number.isFinite)
    if (before === undefined || after.length === 0) return []
    const drop = 12 * Math.log2(hz(before) / Math.min(...after))
    return Number.isFinite(drop)
      ? [{ phrase: k, falls: accentPhrase.fallAfter !== null, drop }]
      : []
  })
}

describe('the VOICEVOX fixtures, tracked', () => {
  test.each(voices.map(voice => voice.id))(
    '%s falls where each right accent falls, and holds where the fall is lost',
    async voiceId => {
      let measured = 0
      for (const phrase of phrases) {
        const right = await dropsAtRightFalls(
          fixtureId(phrase.id, voiceId, 'right', 'clean'),
        )
        for (const drop of right) {
          measured++
          expect(drop.falls).toBe(true)
          expect(
            drop.drop,
            `${phrase.id}, phrase ${drop.phrase}`,
          ).toBeGreaterThan(1)
        }
        const lost = await dropsAtRightFalls(
          fixtureId(phrase.id, voiceId, 'fall-lost', 'clean'),
        )
        for (const drop of lost.filter(d => !d.falls)) {
          measured++
          const rightDrop =
            right.find(d => d.phrase === drop.phrase)?.drop ?? Number.NaN
          // The lost fall's phrase holds within a semitone and a half where the right
          // accent falls by several.
          expect(
            drop.drop,
            `${phrase.id} fall lost, phrase ${drop.phrase}`,
          ).toBeLessThan(1.5)
          expect(rightDrop - drop.drop).toBeGreaterThan(2)
        }
      }
      // Every right fall is between voiced morae except where a devoiced
      // mora sits beside it; most are measured.
      expect(measured).toBeGreaterThanOrEqual(6)
    },
  )
})
