import { describe, expect, test } from 'vitest'

import {
  accentPitches,
  editQuery,
  leadSeconds,
  pitchLevelsOf,
  unevenScales,
} from './voice-fixtures.ts'
import type {
  AudioQuery,
  QueryAccentPhrase,
  QueryMora,
} from './voicevox-query.ts'

const mora = (text: string, pitch = 5.5): QueryMora => ({
  text,
  consonant: null,
  consonant_length: null,
  vowel: pitch === 0 ? 'U' : 'a',
  vowel_length: 0.1,
  pitch,
})

const phrase = (
  morae: ReadonlyArray<QueryMora>,
  accent: number,
  pause = false,
): QueryAccentPhrase => ({
  moras: morae,
  accent,
  pause_mora: pause ? { ...mora('、', 0), vowel: 'pau' } : null,
  is_interrogative: false,
})

const queryOf = (phrases: ReadonlyArray<QueryAccentPhrase>): AudioQuery => ({
  accent_phrases: phrases,
  speed_scale: 1,
  pitch_scale: 0,
  intonation_scale: 1,
  volume_scale: 1,
  pre_phoneme_length: 0.1,
  post_phoneme_length: 0.1,
  output_sampling_rate: 24000,
  output_stereo: false,
})

const levels = { low: 5, high: 6 }

const pitches = (query: AudioQuery): ReadonlyArray<ReadonlyArray<number>> =>
  accentPitches(query, levels).accent_phrases.map(p =>
    p.moras.map(m => Math.round(m.pitch * 1000) / 1000),
  )

describe('the mora pitches set from the accent', () => {
  test('put an atamadaka high on its first mora only', () => {
    expect(
      pitches(queryOf([phrase([mora('ア'), mora('メ'), mora('ガ')], 1)])),
    ).toStrictEqual([[6, 4.99, 4.98]])
  })

  test('start an odaka halfway, high to its fall, then low', () => {
    expect(
      pitches(queryOf([phrase([mora('ハ'), mora('シ'), mora('オ')], 2)])),
    ).toStrictEqual([[5.5, 5.99, 4.98]])
  })

  test('keep a phrase that does not fall high to its end', () => {
    expect(
      pitches(queryOf([phrase([mora('ハ'), mora('シ'), mora('オ')], 3)])),
    ).toStrictEqual([[5.5, 5.99, 5.98]])
  })

  test('lower the top after a fall, and reset it after a pause', () => {
    const fell = phrase([mora('エ'), mora('キ')], 1)
    const next = phrase([mora('フ'), mora('ル')], 2)
    expect(pitches(queryOf([fell, next]))).toStrictEqual([
      [6, 4.99],
      [5.35 - 0.02, 5.7 - 0.03],
    ])
    expect(
      pitches(queryOf([phrase([mora('エ'), mora('キ')], 1, true), next])),
    ).toStrictEqual([
      [6, 4.99],
      [5.48, 5.97],
    ])
  })

  test('leave a devoiced mora with no pitch', () => {
    expect(
      pitches(queryOf([phrase([mora('ス', 0), mora('キ')], 2)])),
    ).toStrictEqual([[0, 5.99]])
  })
})

describe("a voice's pitch levels", () => {
  test('are the 10th and 90th percentile of its voiced morae', () => {
    const query = queryOf([
      phrase(
        Array.from({ length: 11 }, (_, k) => mora(`${k}`, 5 + k / 10)),
        1,
      ),
      phrase([mora('ス', 0)], 1),
    ])
    const { low, high } = pitchLevelsOf([query])
    expect(low).toBeCloseTo(5.1, 6)
    expect(high).toBeCloseTo(5.9, 6)
  })
})

describe('the uneven variant', () => {
  test('holds and clips morae, the same way every run', () => {
    const scales = unevenScales('a/b/uneven', 5)
    expect(scales).toStrictEqual(unevenScales('a/b/uneven', 5))
    expect(scales).toContain(1.6)
    expect(scales).toContain(0.6)
    expect(scales.every(scale => [0.6, 1, 1.6].includes(scale))).toBe(true)
  })
})

describe('the query a variant is synthesised from', () => {
  const query = queryOf([phrase([mora('ア'), mora('メ')], 1)])

  test('has the lead silence and a 32-bit speed', () => {
    const slower = editQuery(query, 'slower', 'x', levels)
    expect(slower.pre_phoneme_length).toBe(Math.fround(leadSeconds))
    expect(slower.speed_scale).toBe(Math.fround(0.8))
    expect(slower.accent_phrases[0]?.moras[0]?.vowel_length).toBe(
      Math.fround(0.1),
    )
  })

  test('scales vowel lengths only when uneven', () => {
    const uneven = editQuery(query, 'uneven', 'x', levels)
    const lengths = uneven.accent_phrases[0]?.moras.map(m => m.vowel_length)
    const scales = unevenScales('x', 2)
    expect(lengths).toStrictEqual(scales.map(s => Math.fround(0.1 * s)))
  })
})
