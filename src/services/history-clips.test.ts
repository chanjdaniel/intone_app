import { Effect, Layer, Option } from 'effect'
import { IDBFactory } from 'fake-indexeddb'

import { describe, expect, it } from '@effect/vitest'

import type { Recording } from '../score/score'
import { syntheticTake } from '../score/synthetic-take'
import { ClipStore, ClipStoreError } from './clip-store'
import type { NewClip } from './history-clips'
import { recordingId } from './history-records'
import { HistoryStore, type NewTake, make } from './history-store'
import { databaseName, stores } from './indexed-db'

const lineCurve = (seed: number): Recording =>
  syntheticTake({
    pattern: [false, true, true, false],
    moraFrames: 9,
    registerHz: 200 + seed,
    spanSemitones: 6,
    seed,
  })

const fileBytes = Uint8Array.from({ length: 64 }, (_, k) => k)

const newClip = (overrides: Partial<NewClip> = {}): NewClip => ({
  name: 'reading.mp3',
  type: 'audio/mpeg',
  addedAt: Date.UTC(2026, 10, 10, 9),
  seconds: 12.5,
  bytes: Uint8Array.from(fileBytes),
  lines: [
    {
      from: 0.4,
      to: 2.9,
      native: { _tag: 'Tracked', recording: lineCurve(1) },
    },
    { from: 3.2, to: 5.0, native: { _tag: 'TooQuiet' } },
    {
      from: 5.4,
      to: 8.1,
      native: { _tag: 'Tracked', recording: lineCurve(2) },
    },
  ],
  ...overrides,
})

const takeOf = (
  clipId: string,
  lineId: string,
  native: Recording,
): NewTake => ({
  clipId,
  lineId,
  lineText: `Line ${lineId}`,
  mode: 'Guided',
  takenAt: Date.UTC(2026, 10, 10, 10),
  day: '2026-11-10',
  native,
  take: lineCurve(9),
  comparison: {
    score: { _tag: 'CouldNotCompare', version: 1, reason: 'TooLittleVoiced' },
    alignedTakeF0: null,
  },
  audio: Option.some({ samples: new Float32Array(480), sampleRate: 48_000 }),
})

const harness = () => {
  const factory = new IDBFactory()
  const files = new Map<string, Uint8Array>()
  const run = <A, E>(
    use: (store: HistoryStore['Service']) => Effect.Effect<A, E>,
  ) =>
    HistoryStore.use(use).pipe(
      Effect.provide(HistoryStore.layerTest(factory, files)),
    )
  return { factory, files, run }
}

const request = <A>(make: () => IDBRequest<A>): Promise<A> =>
  new Promise((resolve, reject) => {
    const made = make()
    made.onsuccess = () => resolve(made.result)
    made.onerror = () => reject(made.error)
  })

const countIn = (factory: IDBFactory, store: string) =>
  Effect.promise(async () => {
    const database = await request(() => factory.open(databaseName))
    const count = await request(() =>
      database.transaction(store, 'readonly').objectStore(store).count(),
    )
    database.close()
    return count
  })

describe('clips in the history', () => {
  it.effect(
    'keeps a clip’s file, its lines and their curves, and reads them back',
    () =>
      Effect.gen(function* () {
        const { run, files, factory } = harness()
        const clip = yield* run(store => store.addClip(newClip()))
        expect(clip.name).toBe('reading.mp3')
        expect(clip.seconds).toBe(12.5)
        expect(clip.audio).toEqual({
          file: `clips/${clip.id}.mp3`,
          type: 'audio/mpeg',
          bytes: 64,
        })
        expect([...(files.get(`clips/${clip.id}.mp3`) ?? [])]).toEqual([
          ...fileBytes,
        ])
        expect(clip.lines).toEqual([
          {
            id: '1',
            from: 0.4,
            to: 2.9,
            native: { _tag: 'Tracked', nativeId: recordingId(lineCurve(1)) },
          },
          { id: '2', from: 3.2, to: 5.0, native: { _tag: 'TooQuiet' } },
          {
            id: '3',
            from: 5.4,
            to: 8.1,
            native: { _tag: 'Tracked', nativeId: recordingId(lineCurve(2)) },
          },
        ])
        expect(yield* countIn(factory, stores.natives)).toBe(2)
        expect(yield* run(store => store.clips)).toEqual({
          clips: [clip],
          unreadable: 0,
        })
        expect(yield* run(store => store.clip(clip.id))).toEqual(
          Option.some(clip),
        )
      }),
  )

  it.effect(
    'reads one line with its native curve, exactly as it was tracked',
    () =>
      Effect.gen(function* () {
        const { run } = harness()
        const clip = yield* run(store => store.addClip(newClip()))
        const found = yield* run(store => store.clipLine(clip.id, '3'))
        if (Option.isNone(found)) {
          throw new Error('no line')
        }
        expect(found.value.line.from).toBe(5.4)
        const native = Option.getOrThrow(found.value.maybeNative)
        expect([...native.curve.f0Hz]).toEqual([...lineCurve(2).curve.f0Hz])
        expect([...native.features.data]).toEqual([
          ...lineCurve(2).features.data,
        ])
        const quiet = yield* run(store => store.clipLine(clip.id, '2'))
        expect(Option.map(quiet, ({ maybeNative }) => maybeNative)).toEqual(
          Option.some(Option.none()),
        )
        expect(yield* run(store => store.clipLine(clip.id, '9'))).toEqual(
          Option.none(),
        )
        expect(yield* run(store => store.clipLine('nothing', '1'))).toEqual(
          Option.none(),
        )
      }),
  )

  it.effect('lists the newest clip first, each with its own id', () =>
    Effect.gen(function* () {
      const { run } = harness()
      const older = yield* run(store => store.addClip(newClip({ addedAt: 1 })))
      const newer = yield* run(store =>
        store.addClip(newClip({ addedAt: 2, name: 'second.wav' })),
      )
      expect(older.id).not.toBe(newer.id)
      expect(newer.audio?.file).toBe(`clips/${newer.id}.wav`)
      const { clips } = yield* run(store => store.clips)
      expect(clips.map(clip => clip.id)).toEqual([newer.id, older.id])
    }),
  )

  it.effect('names a file with no plain extension by its id alone', () =>
    Effect.gen(function* () {
      const { run } = harness()
      const clip = yield* run(store =>
        store.addClip(newClip({ name: 'recording from my phone' })),
      )
      expect(clip.audio?.file).toBe(`clips/${clip.id}.audio`)
    }),
  )

  it.effect(
    'deletes a clip with its lines’ curves, its takes, their kept audio and its file, and nothing else',
    () =>
      Effect.gen(function* () {
        const { run, files, factory } = harness()
        yield* run(store => store.setSettings({ keepTakeAudio: true }))
        const clip = yield* run(store => store.addClip(newClip()))
        const other = yield* run(store =>
          store.addClip(
            newClip({
              lines: [
                {
                  from: 0,
                  to: 2,
                  native: { _tag: 'Tracked', recording: lineCurve(5) },
                },
              ],
            }),
          ),
        )
        yield* run(store => store.keep(takeOf(clip.id, '1', lineCurve(1))))
        yield* run(store => store.keep(takeOf(clip.id, '3', lineCurve(2))))
        const bundled = yield* run(store =>
          store.keep(takeOf('ame-ga-suki', '1', lineCurve(7))),
        )
        expect(files.size).toBe(5)

        yield* run(store => store.removeClip(clip.id))

        expect(yield* run(store => store.clip(clip.id))).toEqual(Option.none())
        const { entries } = yield* run(store => store.entries)
        expect(entries.map(entry => entry.id)).toEqual([bundled.entry.id])
        expect(yield* countIn(factory, stores.takeRecordings)).toBe(1)
        expect(yield* countIn(factory, stores.natives)).toBe(2)
        expect([...files.keys()].sort()).toEqual(
          [`clips/${other.id}.mp3`, bundled.entry.audio?.file ?? ''].sort(),
        )
        expect(
          (yield* run(store => store.clips)).clips.map(found => found.id),
        ).toEqual([other.id])
      }),
  )

  it.effect('keeps a line’s native while another clip shares it', () =>
    Effect.gen(function* () {
      const { run, factory } = harness()
      const first = yield* run(store => store.addClip(newClip()))
      yield* run(store => store.addClip(newClip()))
      yield* run(store => store.removeClip(first.id))
      expect(yield* countIn(factory, stores.natives)).toBe(2)
    }),
  )

  it.effect('keeps no record of a clip whose file could not be written', () =>
    Effect.gen(function* () {
      const factory = new IDBFactory()
      const failingFiles = Layer.succeed(
        ClipStore,
        ClipStore.of({
          write: () =>
            Effect.fail(new ClipStoreError({ reason: 'The disk is full.' })),
          read: () => Effect.succeedNone,
          url: () => Effect.succeedNone,
          remove: () => Effect.void,
          clear: Effect.void,
        }),
      )
      const layer = Layer.effect(HistoryStore, make(factory)).pipe(
        Layer.provide(failingFiles),
      )
      const error = yield* HistoryStore.use(store =>
        store.addClip(newClip()),
      ).pipe(Effect.provide(layer), Effect.flip)
      expect(error.reason).toBe(
        'The clip’s audio was not kept. The disk is full.',
      )
      expect(
        yield* HistoryStore.use(store => store.clips).pipe(
          Effect.provide(layer),
        ),
      ).toEqual({ clips: [], unreadable: 0 })
      expect(yield* countIn(factory, stores.natives)).toBe(0)
    }),
  )

  it.effect('counts a clip record that does not decode as unreadable', () =>
    Effect.gen(function* () {
      const { run, factory } = harness()
      yield* run(store => store.addClip(newClip()))
      yield* Effect.promise(async () => {
        const database = await request(() => factory.open(databaseName))
        await request(() =>
          database
            .transaction(stores.clips, 'readwrite')
            .objectStore(stores.clips)
            .put({ id: 'damaged', format: 1 }),
        )
        database.close()
      })
      const { clips, unreadable } = yield* run(store => store.clips)
      expect(clips).toHaveLength(1)
      expect(unreadable).toBe(1)
      expect(yield* run(store => store.clip('damaged'))).toEqual(Option.none())
    }),
  )

  it.effect(
    'backs a clip up without its file unless asked, and a restore keeps the file a device has',
    () =>
      Effect.gen(function* () {
        const from = harness()
        const clip = yield* from.run(store => store.addClip(newClip()))
        const withoutAudio = yield* from.run(store => store.dump(false))
        expect(withoutAudio.clips).toEqual([{ ...clip, audio: null }])
        expect(withoutAudio.audio.size).toBe(0)
        const withAudio = yield* from.run(store => store.dump(true))
        expect(withAudio.clips).toEqual([clip])
        expect([...withAudio.audio.keys()]).toEqual([clip.audio?.file])

        // Restored on another device without its file: the clip and its
        // lines come back, and it says it has no audio.
        const to = harness()
        yield* to.run(store => store.restore(withoutAudio))
        expect(yield* to.run(store => store.clip(clip.id))).toEqual(
          Option.some({ ...clip, audio: null }),
        )
        expect(to.files.size).toBe(0)
        expect(
          Option.isSome(
            Option.flatMap(
              yield* to.run(store => store.clipLine(clip.id, '1')),
              found => found.maybeNative,
            ),
          ),
        ).toBe(true)

        // Restored on the same device: the file it has is kept.
        yield* from.run(store => store.restore(withoutAudio))
        expect(yield* from.run(store => store.clip(clip.id))).toEqual(
          Option.some(clip),
        )

        // With its file, the file comes too.
        const third = harness()
        yield* third.run(store => store.restore(withAudio))
        expect([...third.files.keys()]).toEqual([clip.audio?.file])
        expect(yield* third.run(store => store.clip(clip.id))).toEqual(
          Option.some(clip),
        )
      }),
  )

  it.effect('clearing everything deletes the clips and their files', () =>
    Effect.gen(function* () {
      const { run, files } = harness()
      yield* run(store => store.addClip(newClip()))
      yield* run(store => store.clear)
      expect(files.size).toBe(0)
      expect((yield* run(store => store.clips)).clips).toEqual([])
    }),
  )

  it.effect(
    'opens a database of version 2, keeping its takes, and adds the clips',
    () =>
      Effect.gen(function* () {
        const before = harness()
        const kept = yield* before.run(store =>
          store.keep(takeOf('ame-ga-suki', '1', lineCurve(1))),
        )
        const taken = yield* Effect.promise(async () => {
          const database = await request(() =>
            before.factory.open(databaseName),
          )
          const value = await request(() =>
            database
              .transaction(stores.takes, 'readonly')
              .objectStore(stores.takes)
              .get(kept.entry.id),
          )
          database.close()
          return value
        })
        const { factory, run } = harness()
        yield* Effect.promise(async () => {
          const opening = factory.open(databaseName, 2)
          opening.onupgradeneeded = () => {
            const database = opening.result
            database.createObjectStore(stores.nativeCurves)
            database.createObjectStore(stores.takes, { keyPath: 'id' })
            database.createObjectStore(stores.takeRecordings, { keyPath: 'id' })
            database.createObjectStore(stores.natives, { keyPath: 'id' })
            database.createObjectStore(stores.meta)
          }
          const database = await request(() => opening)
          await request(() =>
            database
              .transaction(stores.takes, 'readwrite')
              .objectStore(stores.takes)
              .put(taken),
          )
          database.close()
        })
        expect((yield* run(store => store.entries)).entries).toEqual([
          kept.entry,
        ])
        expect(yield* run(store => store.clips)).toEqual({
          clips: [],
          unreadable: 0,
        })
        const clip = yield* run(store => store.addClip(newClip()))
        expect((yield* run(store => store.clips)).clips).toEqual([clip])
      }),
  )
})
