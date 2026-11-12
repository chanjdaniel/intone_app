import { describe, expect, test } from 'vitest'

import { type Score, scoreTake } from '../../src/score/score.ts'
import {
  type StudyPair,
  flatTake,
  isWrong,
  median,
  scored,
  studyPairs,
  wrongVariants,
} from '../support/score-study.ts'
import { conditions, phrases, voices } from '../support/voice-fixture-set.ts'

// The score on the VOICEVOX fixtures' tracked curves and features
// (fixtures/tracked/): each voice's clean right take as the native, copied
// by each other voice (docs/score.md, "Across voices").

const pairs = studyPairs()
const scores = new Map<StudyPair, Score>(
  pairs.map(pair => [pair, scored(pair).score]),
)
const match = (pair: StudyPair): number => {
  const score = scores.get(pair)
  return score?._tag === 'Scored' ? score.match : Number.NaN
}
const pitchAccent = (pair: StudyPair): number => {
  const score = scores.get(pair)
  return score?._tag === 'Scored' ? score.parts.pitchAccent : Number.NaN
}
const find = (like: StudyPair, variant: string) =>
  pairs.find(
    pair =>
      pair.phrase === like.phrase &&
      pair.nativeVoice === like.nativeVoice &&
      pair.takeVoice === like.takeVoice &&
      pair.condition === like.condition &&
      pair.variant === variant,
  )

describe('the score across voices', () => {
  test('scores a wrong accent below the right one in the same voice, every voice and condition', () => {
    let compared = 0
    for (const right of pairs.filter(pair => pair.variant === 'right')) {
      for (const variant of wrongVariants) {
        const wrong = find(right, variant)
        if (wrong === undefined || scores.get(wrong)?._tag !== 'Scored')
          continue
        compared++
        const label = `${right.phrase}, ${right.takeVoice} copying ${right.nativeVoice}, ${right.condition}, ${variant}`
        expect(match(wrong), label).toBeLessThan(match(right))
        expect(pitchAccent(wrong), label).toBeLessThan(pitchAccent(right))
      }
    }
    expect(compared).toBeGreaterThan(1000)
  })

  test('scores right takes of one phrase within 0.55 of each other, half of them within 0.25', () => {
    for (const phrase of phrases) {
      const spreads: Array<number> = []
      for (const native of voices) {
        for (const condition of conditions) {
          const matches = pairs
            .filter(
              pair =>
                pair.phrase === phrase.id &&
                pair.nativeVoice === native.id &&
                pair.condition === condition &&
                pair.variant === 'right',
            )
            .map(match)
          expect(matches.every(Number.isFinite)).toBe(true)
          spreads.push(Math.max(...matches) - Math.min(...matches))
        }
      }
      expect(Math.max(...spreads), phrase.id).toBeLessThan(0.55)
      expect(median(spreads), phrase.id).toBeLessThan(0.25)
    }
  })

  test('keeps the timing of a right take said slower or faster throughout', () => {
    const timing = (variant: string) =>
      median(
        pairs
          .filter(pair => pair.variant === variant)
          .map(pair => {
            const score = scores.get(pair)
            return score?._tag === 'Scored' ? score.parts.timing : Number.NaN
          }),
      )
    for (const variant of ['slower', 'faster']) {
      expect(timing(variant)).toBeGreaterThan(0.9)
      expect(Math.abs(timing(variant) - timing('right'))).toBeLessThan(0.05)
    }
  })

  test('compares every clean right take, and refuses under 1% of takes', () => {
    const refused = pairs.filter(
      pair => scores.get(pair)?._tag === 'CouldNotCompare',
    )
    expect(
      refused.filter(
        pair => pair.variant === 'right' && pair.condition === 'clean',
      ),
    ).toStrictEqual([])
    expect(refused.length / pairs.length).toBeLessThan(0.01)
  })

  test('marks a worst stretch on the accent phrase a wrong take changed', () => {
    let marked = 0
    const wrong = pairs.filter(
      pair => isWrong(pair.variant) && pair.condition === 'clean',
    )
    for (const pair of wrong) {
      const score = scores.get(pair)
      if (score?._tag !== 'Scored') continue
      const changed = pair.take.labels.accentPhrases.findIndex(
        phrase => phrase.fallAfter !== phrase.rightFallAfter,
      )
      const morae = pair.native.labels.morae.filter(
        mora => mora.phrase === changed,
      )
      const from = morae[0]?.startSeconds ?? 0
      const to = morae.at(-1)?.endSeconds ?? 0
      const { nativeFrom, nativeTo } = score.worstStretch
      if (Math.min(to, nativeTo) - Math.max(from, nativeFrom) > 0.1) marked++
    }
    expect(marked).toBe(wrong.length)
  })

  test('scores a flat take near zero', () => {
    const flat = pairs
      .filter(pair => pair.variant === 'right' && pair.condition === 'clean')
      .map(pair => {
        const score = scoreTake(
          pair.native.recording,
          flatTake(pair.take).recording,
        ).score
        return score._tag === 'Scored' ? score.parts.pitchAccent : Number.NaN
      })
    expect(Math.max(...flat)).toBeLessThan(0.05)
  })

  test('moves the pitch part by under 0.05 for octave jumps in one voiced frame in 50', () => {
    for (const pair of pairs.filter(
      pair => pair.variant === 'right' && pair.condition === 'clean',
    )) {
      const f0Hz = pair.take.recording.curve.f0Hz.slice()
      let voiced = 0
      for (let f = 0; f < f0Hz.length; f++) {
        if ((f0Hz[f] ?? 0) <= 0) continue
        voiced++
        if (voiced % 50 === 0)
          f0Hz[f] = (f0Hz[f] ?? 0) * (voiced % 100 === 0 ? 2 : 0.5)
      }
      const jumped = scoreTake(pair.native.recording, {
        ...pair.take.recording,
        curve: { ...pair.take.recording.curve, f0Hz },
      }).score
      expect(jumped._tag).toBe('Scored')
      if (jumped._tag === 'Scored') {
        expect(
          Math.abs(jumped.parts.pitchAccent - pitchAccent(pair)),
        ).toBeLessThan(0.05)
      }
    }
  })
})
