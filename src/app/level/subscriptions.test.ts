import { Effect, Fiber, Layer, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { IDBFactory } from 'fake-indexeddb'

import { describe, expect, it } from '@effect/vitest'

import { ClipStore } from '../../services/clip-store'
import { HistoryStore } from '../../services/history-store'
import { type Heard, Playback } from '../../services/playback'
import { Message } from '../message'
import { levelPlaybackEvents } from './subscriptions'

// The level's playback Subscription on the test layers: it plays the
// line's stretch of the kept clip, says where it has got to every 50 ms,
// and ends saying so; a clip whose file is gone says why.

const run = (
  play: Parameters<typeof levelPlaybackEvents>[0],
  heard: Array<Heard>,
  factory: IDBFactory,
  files: Map<string, Uint8Array>,
) =>
  levelPlaybackEvents(play).pipe(
    Stream.runCollect,
    Effect.provide(
      Layer.mergeAll(
        Layer.fresh(Playback.layerTest(heard, 10)),
        ClipStore.layerMemory(files),
        HistoryStore.layerTest(factory, files),
      ),
    ),
  )

const settled = Effect.promise(
  () => new Promise<void>(resolve => setTimeout(resolve, 0)),
)

const keptClip = (factory: IDBFactory, files: Map<string, Uint8Array>) =>
  HistoryStore.use(store =>
    store.addClip({
      name: 'reading.wav',
      type: 'audio/wav',
      addedAt: 1,
      seconds: 10,
      bytes: Uint8Array.of(1, 2, 3, 4),
      lines: [{ from: 1, to: 3, native: { _tag: 'TooQuiet' } }],
    }),
  ).pipe(Effect.provide(HistoryStore.layerTest(factory, files)))

describe('playing a line on its level', () => {
  it.effect(
    'plays its stretch of the clip, moving the playhead, then says it ended',
    () =>
      Effect.gen(function* () {
        const factory = new IDBFactory()
        const files = new Map<string, Uint8Array>()
        const clip = yield* keptClip(factory, files)
        const heard: Array<Heard> = []
        const fiber = yield* run(
          { clipId: clip.id, playNumber: 3, from: 1.5, to: 1.6 },
          heard,
          factory,
          files,
        ).pipe(Effect.forkChild)
        // The clip is read from IndexedDB before the play starts.
        yield* settled.pipe(Effect.repeat({ until: () => heard.length > 0 }))
        yield* TestClock.adjust('100 millis')
        const messages = yield* Fiber.join(fiber)
        expect(heard).toHaveLength(1)
        expect(heard[0]).toMatchObject({
          voice: 'Line',
          rate: 1,
          stretch: { from: 1.5, to: 1.6 },
        })
        expect(messages.at(-1)).toStrictEqual(
          Message.EndedLevelPlayback({ playNumber: 3 }),
        )
        const moves = messages.slice(0, -1)
        expect(moves[0]).toStrictEqual(
          Message.MovedLevelPlayhead({ playNumber: 3, seconds: 1.5 }),
        )
        expect(moves.length).toBeGreaterThanOrEqual(2)
        moves.forEach(moved => {
          expect(moved._tag).toBe('MovedLevelPlayhead')
        })
      }),
  )

  it.effect('says why when the clip’s file is no longer there', () =>
    Effect.gen(function* () {
      const factory = new IDBFactory()
      const files = new Map<string, Uint8Array>()
      const clip = yield* keptClip(factory, files)
      files.clear()
      const messages = yield* run(
        { clipId: clip.id, playNumber: 1, from: 1, to: 3 },
        [],
        factory,
        files,
      )
      expect(messages).toStrictEqual([
        Message.FailedLevelPlayback({
          playNumber: 1,
          reason: 'The clip’s audio is no longer on this device.',
        }),
      ])
    }),
  )
})
