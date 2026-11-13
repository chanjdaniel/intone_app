import { describe, expect, test } from 'vitest'

import {
  type AudioQuery,
  type QueryMora,
  samplesPerFrame,
  timelineOf,
  toFrameLength,
} from './voicevox-query.ts'

const mora = (
  text: string,
  consonant: [string, number] | null,
  vowel: string,
  vowelLength: number,
  pitch: number,
): QueryMora => ({
  text,
  consonant: consonant?.[0] ?? null,
  consonant_length: consonant?.[1] ?? null,
  vowel,
  vowel_length: vowelLength,
  pitch,
})

// あめが、すき: two accent phrases split by a pause, す devoiced.
const query = (overrides: Partial<AudioQuery> = {}): AudioQuery => ({
  accent_phrases: [
    {
      moras: [
        mora('ア', null, 'a', 0.12, 5.8),
        mora('メ', ['m', 0.06], 'e', 0.1, 5.5),
        mora('ガ', ['g', 0.04], 'a', 0.1, 5.4),
      ],
      accent: 1,
      pause_mora: mora('、', null, 'pau', 0.3, 0),
      is_interrogative: false,
    },
    {
      moras: [
        mora('ス', ['s', 0.08], 'U', 0.05, 0),
        mora('キ', ['k', 0.07], 'i', 0.14, 5.6),
      ],
      accent: 2,
      pause_mora: null,
      is_interrogative: false,
    },
  ],
  speed_scale: 1,
  pitch_scale: 0,
  intonation_scale: 1,
  volume_scale: 1,
  pre_phoneme_length: 0.1,
  post_phoneme_length: 0.1,
  output_sampling_rate: 24000,
  output_stereo: false,
  ...overrides,
})

describe('a length in frames', () => {
  test('is 93.75 frames a second, rounded', () => {
    expect(toFrameLength(0.1, 1)).toBe(9)
    expect(toFrameLength(1, 1)).toBe(94)
  })

  test('rounds a half to the even frame, as VOICEVOX does', () => {
    // 0.016 s is 1.5 frames, and 0.048 s 4.5 frames.
    expect(toFrameLength(0.016, 1)).toBe(2)
    expect(toFrameLength(0.048, 1)).toBe(4)
  })

  test('divides by the speed after rounding', () => {
    // 0.1 s rounds to 9 frames, then 9 / 1.25 = 7.2.
    expect(toFrameLength(0.1, 1.25)).toBe(7)
    expect(toFrameLength(0.1, 0.8)).toBe(11)
  })

  test('is 256 samples at 24 kHz', () => {
    expect(samplesPerFrame).toBe(256)
  })
})

describe('the timeline of a query', () => {
  test('places each mora by its consonant and vowel lengths', () => {
    const timeline = timelineOf(query())
    expect(timeline.speechFrom).toBe(9)
    expect(
      timeline.morae.map(m => [m.text, m.startFrame, m.vowelFrame, m.endFrame]),
    ).toStrictEqual([
      ['ア', 9, 9, 20],
      ['メ', 20, 26, 35],
      ['ガ', 35, 39, 48],
      ['ス', 76, 84, 89],
      ['キ', 89, 96, 109],
    ])
    expect(timeline.pauses).toStrictEqual([
      { afterPhrase: 0, startFrame: 48, endFrame: 76 },
    ])
    expect(timeline.speechTo).toBe(109)
    expect(timeline.frames).toBe(118)
  })

  test('marks a devoiced mora, which has no pitch', () => {
    const [, , , su, ki] = timelineOf(query()).morae
    expect(su?.devoiced).toBe(true)
    expect(su?.pitchHz).toBeNull()
    expect(ki?.devoiced).toBe(false)
    expect(ki?.pitchHz).toBeCloseTo(Math.exp(5.6), 3)
  })

  test('numbers each mora within its accent phrase', () => {
    expect(
      timelineOf(query()).morae.map(m => [m.phrase, m.index]),
    ).toStrictEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ])
  })

  test('spreads the pitches around their mean by the intonation scale', () => {
    const plain = timelineOf(query()).morae
    const wide = timelineOf(query({ intonation_scale: 2 })).morae
    const mean = (5.8 + 5.5 + 5.4 + 5.6) / 4
    for (const [k, m] of wide.entries()) {
      const before = plain[k]?.pitchHz ?? null
      if (before === null) {
        expect(m.pitchHz).toBeNull()
      } else {
        const log = Math.log(before)
        expect(Math.log(m.pitchHz ?? 0)).toBeCloseTo(mean + 2 * (log - mean), 4)
      }
    }
  })

  test('refuses a question, whose last mora VOICEVOX lengthens', () => {
    const asked = query()
    expect(() =>
      timelineOf({
        ...asked,
        accent_phrases: asked.accent_phrases.map(phrase => ({
          ...phrase,
          is_interrogative: true,
        })),
      }),
    ).toThrow(/question/)
  })
})
