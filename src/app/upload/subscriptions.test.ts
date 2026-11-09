import { Effect, Layer, Stream } from 'effect'
import { IDBFactory } from 'fake-indexeddb'

import { describe, expect, it } from '@effect/vitest'

import { syntheticTake } from '../../score/synthetic-take'
import {
  ClipAnalyser,
  ClipAnalyserError,
  type ClipEvent,
} from '../../services/clip-analyser'
import { HistoryStore } from '../../services/history-store'
import { Message } from '../message'
import { uploadEvents } from './subscriptions'
import { UploadStep } from './upload'

// The upload Subscription's stream on the analyser's and the history's
// test layers: the steps it tells the Model, and the clip it keeps.

const recording = syntheticTake({
  pattern: [false, true, false],
  moraFrames: 9,
  registerHz: 210,
  spanSemitones: 6,
  seed: 4,
})

const analysed: ClipEvent = {
  _tag: 'Analysed',
  seconds: 8,
  lines: [
    { from: 0.5, to: 2.5, native: { _tag: 'Tracked', recording } },
    { from: 3, to: 5, native: { _tag: 'TooNoisy' } },
  ],
}

const file = new File([Uint8Array.of(1, 2, 3, 4)], 'reading.m4a', {
  type: 'audio/mp4',
})

const run = (answer: ReadonlyArray<ClipEvent> | ClipAnalyserError) => {
  const factory = new IDBFactory()
  const files = new Map<string, Uint8Array>()
  const history = HistoryStore.layerTest(factory, files)
  return {
    files,
    history,
    messages: uploadEvents(1, file).pipe(
      Stream.runCollect,
      Effect.provide(
        Layer.merge(
          ClipAnalyser.layerTest(() => answer),
          history,
        ),
      ),
    ),
  }
}

describe('the upload stream', () => {
  it.effect(
    'tells each step, then keeps the clip, its file and its lines, and says its id',
    () =>
      Effect.gen(function* () {
        const { messages, files, history } = run([
          { _tag: 'Checking' },
          { _tag: 'Decoding' },
          { _tag: 'FindingLines', done: 5, total: 10 },
          { _tag: 'TrackingLines', done: 1, total: 2 },
          analysed,
        ])
        const said = yield* messages
        expect(said.slice(0, -1)).toStrictEqual([
          Message.ProgressedUpload({
            jobNumber: 1,
            step: UploadStep.Checking(),
          }),
          Message.ProgressedUpload({
            jobNumber: 1,
            step: UploadStep.Decoding(),
          }),
          Message.ProgressedUpload({
            jobNumber: 1,
            step: UploadStep.FindingLines({ done: 5, total: 10 }),
          }),
          Message.ProgressedUpload({
            jobNumber: 1,
            step: UploadStep.TrackingLines({ done: 1, total: 2 }),
          }),
          Message.ProgressedUpload({
            jobNumber: 1,
            step: UploadStep.Keeping(),
          }),
        ])
        const last = said.at(-1)
        if (last?._tag !== 'SucceededUpload') {
          throw new Error(`ended with ${last?._tag}`)
        }
        const { clips } = yield* HistoryStore.use(store => store.clips).pipe(
          Effect.provide(history),
        )
        expect(clips).toHaveLength(1)
        expect(clips[0]).toMatchObject({
          id: last.clipId,
          name: 'reading.m4a',
          seconds: 8,
          audio: { type: 'audio/mp4', bytes: 4 },
          lines: [
            { id: '1', from: 0.5, to: 2.5, native: { _tag: 'Tracked' } },
            { id: '2', from: 3, to: 5, native: { _tag: 'TooNoisy' } },
          ],
        })
        expect([...files.values()].map(bytes => [...bytes])).toStrictEqual([
          [1, 2, 3, 4],
        ])
      }),
  )

  it.effect('says why the file could not be used, and keeps nothing', () =>
    Effect.gen(function* () {
      const { messages, files } = run(
        new ClipAnalyserError({
          failure: 'TooLong',
          reason: 'It is 12:00 long, and a clip can be at most 10 minutes.',
        }),
      )
      expect(yield* messages).toStrictEqual([
        Message.FailedUpload({
          jobNumber: 1,
          reason: 'It is 12:00 long, and a clip can be at most 10 minutes.',
        }),
      ])
      expect(files.size).toBe(0)
    }),
  )
})
