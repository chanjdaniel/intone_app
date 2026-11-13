import { Effect, Option } from 'effect'
import { IDBFactory } from 'fake-indexeddb'

import { describe, expect, it } from '@effect/vitest'

import { alignedTakeF0 } from '../score/align'
import type { Recording } from '../score/score'
import { scoreTake } from '../score/score'
import { syntheticTake } from '../score/synthetic-take'
import { HistoryStore } from './history-store'

// The text and its readings are display only (spec, user stories 57 and
// 58): a line's text, the learner's own or a wrong transcript, and the
// readings the learner corrects on it never change what a take is scored
// against, nor a kept take's score. The score reads two recordings and
// nothing else; this holds that the text written beside a line, and its
// readings, leave its recording, and every score of it, as they were.

const quality = {
  speechFrames: 40,
  confidentShare: 0.7,
  pauseFrames: 12,
  pausePitchedShare: 0,
}

const recordingOf = (seed: number): Recording =>
  syntheticTake({
    pattern: [false, true, true, false],
    moraFrames: 9,
    registerHz: 200 + seed,
    spanSemitones: 6,
    seed,
  })

const comparisonOf = (native: Recording, take: Recording) => {
  const { score, alignment } = scoreTake(native, take)
  return {
    score,
    alignedTakeF0:
      alignment === null
        ? null
        : alignedTakeF0(alignment, take.curve.f0Hz, native.curve.f0Hz.length),
  }
}

describe('the text beside a line, and its readings', () => {
  it.effect(
    'never change the recording a take is scored against, nor the score of a take kept before or after',
    () =>
      Effect.gen(function* () {
        const history = yield* HistoryStore
        const clip = yield* history.addClip({
          name: 'reading.mp3',
          type: 'audio/mpeg',
          addedAt: Date.UTC(2026, 10, 13, 9),
          seconds: 6,
          bytes: Uint8Array.from({ length: 32 }, (_, k) => k),
          lines: [
            {
              from: 0.4,
              to: 2.9,
              native: {
                _tag: 'Tracked',
                recording: recordingOf(1),
                quality,
              },
            },
          ],
        })
        const take = recordingOf(7)
        const nativeBefore = Option.getOrThrow(
          Option.getOrThrow(yield* history.clipLine(clip.id, '1')).maybeNative,
        )
        const scoreBefore = comparisonOf(nativeBefore, take)
        yield* history.keep({
          clipId: clip.id,
          lineId: '1',
          lineText: 'Line 1',
          mode: 'Guided',
          takenAt: Date.UTC(2026, 10, 13, 10),
          day: '2026-11-13',
          native: nativeBefore,
          take,
          comparison: scoreBefore,
          audio: Option.none(),
        })
        const keptBefore = (yield* history.entries).entries

        // A transcript that is wrong, and then the learner's own text.
        yield* history.setClipTranscript(clip.id, {
          model: 'whisper-base',
          version: '0123456789abcdef',
          device: 'Wasm',
          at: Date.UTC(2026, 10, 13, 11),
          pieces: [{ text: '方向を', from: 1, to: 1.5 }],
        })
        const wrongNative = Option.getOrThrow(
          Option.getOrThrow(yield* history.clipLine(clip.id, '1')).maybeNative,
        )
        yield* history.setLineTexts(clip.id, [{ lineId: '1', text: '方こそ' }])
        const editedNative = Option.getOrThrow(
          Option.getOrThrow(yield* history.clipLine(clip.id, '1')).maybeNative,
        )

        // The learner corrects a reading of the line's text.
        yield* history.setLineReadings(clip.id, '1', {
          text: '方こそ',
          fixes: [{ from: 0, to: 1, kana: 'ほう' }],
        })
        const readNative = Option.getOrThrow(
          Option.getOrThrow(yield* history.clipLine(clip.id, '1')).maybeNative,
        )

        expect(wrongNative).toStrictEqual(nativeBefore)
        expect(editedNative).toStrictEqual(nativeBefore)
        expect(readNative).toStrictEqual(nativeBefore)
        expect(comparisonOf(readNative, take)).toStrictEqual(scoreBefore)
        expect((yield* history.entries).entries).toStrictEqual(keptBefore)
      }).pipe(
        Effect.provide(HistoryStore.layerTest(new IDBFactory(), new Map())),
      ),
  )
})
