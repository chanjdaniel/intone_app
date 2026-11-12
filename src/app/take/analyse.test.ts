import { Effect, Layer } from 'effect'
import { IDBFactory } from 'fake-indexeddb'

import { describe, expect, it } from '@effect/vitest'

import type { Score } from '../../score/score'
import { syntheticTake } from '../../score/synthetic-take'
import { HistoryStore } from '../../services/history-store'
import { type Comparison, Scorer } from '../../services/scorer'
import type { TrackerResult } from '../../services/tracker'
import { payloadOf } from '../../workers/recording-payload'
import { Message } from '../message'
import { analyseTake } from './commands'
import { TakeResult, takeCurveOf, takeFeaturesOf, takeScoreOf } from './take'

// AnalyseTake's effect on the Scorer's and the history's test layers, with
// a tracker that answers one take: what the Model hears, what the Scorer
// is asked, and what the history keeps.

const line = [true, false, false, false, true]
const nativeRecording = syntheticTake({
  pattern: line,
  moraFrames: 9,
  registerHz: 220,
  spanSemitones: 5,
  seed: 1,
})
const takeRecording = syntheticTake({
  pattern: line,
  moraFrames: 10,
  registerHz: 130,
  spanSemitones: 5,
  seed: 2,
})
const native = {
  curve: takeCurveOf(nativeRecording.curve),
  features: takeFeaturesOf(nativeRecording.features),
}
const takeLine = { clipId: 'ame-ga-suki', lineId: '1', lineText: '雨が好き' }

const tracked = (): TrackerResult => ({
  _tag: 'Tracked',
  ...payloadOf(takeRecording.curve, takeRecording.features),
  peakDb: -12,
  gainDb: 0,
})

// The Scorer's answer: a score no maths would give, so a take that shows
// it was scored by the layer it was given.
const answer: Score = {
  _tag: 'Scored',
  version: 1,
  match: 0.5,
  parts: { pitchAccent: 0.25, timing: 0.875 },
  worstStretch: { nativeFrom: 0.1, nativeTo: 0.5, takeFrom: 0.2, takeTo: 0.6 },
  provisional: true,
}

const run = (result: TrackerResult) => {
  const asked: Array<number> = []
  const scorer = Scorer.layerTest((_native, take): Comparison => {
    asked.push(take.curve.f0Hz.length)
    return { score: answer, alignedTakeF0: null }
  })
  const history = HistoryStore.layerTest(new IDBFactory(), new Map())
  return {
    asked,
    history,
    heard: analyseTake({
      takeNumber: 3,
      mode: 'Guided',
      line: takeLine,
      native,
      tracker: { finish: Effect.succeed(result) },
    }).pipe(Effect.provide(Layer.merge(scorer, history))),
  }
}

describe('analysing a take', () => {
  it.effect(
    'scores the tracked take with the Scorer it is given, keeps it in the history, and brings its curve and score to the Model',
    () =>
      Effect.gen(function* () {
        const { asked, history, heard } = run(tracked())
        const message = yield* heard
        expect(asked).toStrictEqual([takeRecording.curve.f0Hz.length])
        if (
          message._tag !== 'SucceededAnalyseTake' ||
          message.result._tag !== 'Tracked'
        ) {
          throw new Error(`heard ${message._tag}`)
        }
        expect(message.takeNumber).toBe(3)
        expect(message.result.curve).toStrictEqual(
          takeCurveOf(takeRecording.curve),
        )
        expect(message.result.score).toStrictEqual(
          takeScoreOf({ score: answer, alignedTakeF0: null }, nativeRecording),
        )
        expect(message.result.kept._tag).toBe('Kept')
        const { entries } = yield* HistoryStore.use(
          store => store.entries,
        ).pipe(Effect.provide(history))
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
          ...takeLine,
          mode: 'Guided',
          score: { _tag: 'Scored', match: 0.5 },
        })
      }),
  )

  it.effect(
    'says a take too quiet or too noisy to track, asking the Scorer nothing and keeping nothing',
    () =>
      Effect.gen(function* () {
        for (const result of [
          { _tag: 'TooQuiet', peakDb: -70 },
          { _tag: 'TooNoisy', peakDb: -10 },
        ] as const) {
          const { asked, history, heard } = run(result)
          expect(yield* heard).toStrictEqual(
            Message.SucceededAnalyseTake({
              takeNumber: 3,
              result:
                result._tag === 'TooQuiet'
                  ? TakeResult.TooQuiet()
                  : TakeResult.TooNoisy(),
            }),
          )
          expect(asked).toStrictEqual([])
          const { entries } = yield* HistoryStore.use(
            store => store.entries,
          ).pipe(Effect.provide(history))
          expect(entries).toStrictEqual([])
        }
      }),
  )
})
