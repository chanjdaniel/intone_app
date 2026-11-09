import { Effect, Layer, Option } from 'effect'
import { IDBFactory } from 'fake-indexeddb'

import { describe, expect, it } from '@effect/vitest'

import { decodeWav } from '../engine/audio/wav'
import type { Recording } from '../score/score'
import { syntheticTake } from '../score/synthetic-take'
import { ClipStore, ClipStoreError } from './clip-store'
import { recordingId } from './history-records'
import { HistoryStore, type NewTake, audioPathOf, make } from './history-store'
import { databaseName, stores } from './indexed-db'
import type { Comparison } from './scorer'

const native = syntheticTake({
  pattern: [false, true, true, false],
  moraFrames: 9,
  registerHz: 220,
  spanSemitones: 6,
  seed: 1,
})
const learner = syntheticTake({
  pattern: [false, true, true, false],
  moraFrames: 10,
  registerHz: 140,
  spanSemitones: 5,
  seed: 2,
})

const scored: Comparison = {
  score: {
    _tag: 'Scored',
    version: 1,
    match: 0.8,
    parts: { pitchAccent: 0.9, timing: 0.65 },
    worstStretch: {
      nativeFrom: 0.2,
      nativeTo: 0.6,
      takeFrom: 0.25,
      takeTo: 0.7,
    },
    provisional: true,
  },
  alignedTakeF0: Float32Array.from(native.curve.f0Hz, hz => hz * 0.6),
}

const audio = {
  samples: Float32Array.from({ length: 4800 }, (_, k) => Math.sin(k / 9) / 2),
  sampleRate: 48_000,
}

const newTake = (overrides: Partial<NewTake> = {}): NewTake => ({
  clipId: 'ame-ga-suki',
  lineId: '1',
  lineText: '雨が好き',
  mode: 'Guided',
  takenAt: Date.UTC(2026, 10, 9, 10, 30),
  day: '2026-11-09',
  native,
  take: learner,
  comparison: scored,
  audio: Option.some(audio),
  ...overrides,
})

const expectSameRecording = (actual: Recording, expected: Recording) => {
  expect(actual.curve.frameHz).toBe(expected.curve.frameHz)
  expect(actual.curve.onsetFrame).toBe(expected.curve.onsetFrame)
  expect([...actual.curve.f0Hz]).toEqual([...expected.curve.f0Hz])
  expect([...actual.curve.confidence]).toEqual([...expected.curve.confidence])
  expect([...actual.curve.levelDb]).toEqual([...expected.curve.levelDb])
  expect(actual.features.dims).toBe(expected.features.dims)
  expect([...actual.features.data]).toEqual([...expected.features.data])
}

// A history on a fresh in-memory IndexedDB, its audio in `files`.
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

// Opens the database at `version` with `upgrade`, as an older or newer
// copy of the app would have, and closes it.
const plantDatabase = (
  factory: IDBFactory,
  version: number,
  upgrade: (database: IDBDatabase) => void,
  fill: (database: IDBDatabase) => Promise<void> = async () => {},
) =>
  Effect.promise(async () => {
    const opening = factory.open(databaseName, version)
    opening.onupgradeneeded = () => upgrade(opening.result)
    const database = await request(() => opening)
    await fill(database)
    database.close()
  })

const putRaw = (
  database: IDBDatabase,
  store: string,
  value: unknown,
  key?: string,
) =>
  request(() =>
    database.transaction(store, 'readwrite').objectStore(store).put(value, key),
  )

const readRaw = (factory: IDBFactory, store: string) =>
  Effect.promise(async () => {
    const database = await request(() => factory.open(databaseName))
    const values = await request(() =>
      database.transaction(store, 'readonly').objectStore(store).getAll(),
    )
    const version = database.version
    database.close()
    return { values, version }
  })

describe('the history store', () => {
  it.effect(
    'keeps a take’s line, mode, date, curves, score and score version, and reads them back',
    () =>
      Effect.gen(function* () {
        const { run } = harness()
        const kept = yield* run(store => store.keep(newTake()))
        expect(kept.maybeAudioFailure).toEqual(Option.none())
        const { entries, unreadable } = yield* run(store => store.entries)
        expect(unreadable).toBe(0)
        expect(entries).toEqual([
          {
            format: 1,
            id: kept.entry.id,
            clipId: 'ame-ga-suki',
            lineId: '1',
            lineText: '雨が好き',
            mode: 'Guided',
            takenAt: Date.UTC(2026, 10, 9, 10, 30),
            day: '2026-11-09',
            nativeId: recordingId(native),
            score: scored.score,
            audio: null,
          },
        ])
        const full = yield* run(store => store.fullTake(kept.entry.id))
        expect(Option.isSome(full)).toBe(true)
        if (Option.isSome(full)) {
          expectSameRecording(full.value.take, learner)
          expectSameRecording(full.value.native, native)
          expect([...(full.value.alignedF0 ?? [])]).toEqual([
            ...(scored.alignedTakeF0 ?? []),
          ])
        }
      }),
  )

  it.effect('gives each take its own id, and keeps a shared native once', () =>
    Effect.gen(function* () {
      const { run, factory } = harness()
      const first = yield* run(store => store.keep(newTake()))
      const second = yield* run(store => store.keep(newTake()))
      expect(first.entry.id).not.toBe(second.entry.id)
      const natives = yield* readRaw(factory, stores.natives)
      expect(natives.values).toHaveLength(1)
      const other = syntheticTake({
        pattern: [true, false, false],
        moraFrames: 9,
        registerHz: 200,
        spanSemitones: 6,
        seed: 3,
      })
      yield* run(store => store.keep(newTake({ native: other })))
      expect((yield* readRaw(factory, stores.natives)).values).toHaveLength(2)
    }),
  )

  it.effect(
    'reads a take whose record does not decode as unreadable, and skips it',
    () =>
      Effect.gen(function* () {
        const { run, factory } = harness()
        yield* run(store => store.keep(newTake()))
        yield* Effect.promise(async () => {
          const database = await request(() => factory.open(databaseName))
          await putRaw(database, stores.takes, {
            format: 1,
            id: 'damaged',
            score: 'lost',
          })
          database.close()
        })
        const { entries, unreadable } = yield* run(store => store.entries)
        expect(entries).toHaveLength(1)
        expect(unreadable).toBe(1)
        expect(yield* run(store => store.fullTake('damaged'))).toEqual(
          Option.none(),
        )
      }),
  )

  it.effect(
    'opens a database planted by the app before history, keeping its native curves',
    () =>
      Effect.gen(function* () {
        const { run, factory } = harness()
        const cached = { format: 2, planted: true }
        yield* plantDatabase(
          factory,
          1,
          database => database.createObjectStore(stores.nativeCurves),
          database =>
            putRaw(database, stores.nativeCurves, cached, 'line-key').then(
              () => {},
            ),
        )
        expect(yield* run(store => store.entries)).toEqual({
          entries: [],
          unreadable: 0,
        })
        const curves = yield* readRaw(factory, stores.nativeCurves)
        expect(curves.version).toBe(2)
        expect(curves.values).toEqual([cached])
        expect((yield* readRaw(factory, stores.meta)).values).toEqual([
          { format: 1 },
        ])
        yield* run(store => store.keep(newTake()))
        expect((yield* run(store => store.entries)).entries).toHaveLength(1)
      }),
  )

  it.effect(
    'says so when the database was made by a newer copy of the app',
    () =>
      Effect.gen(function* () {
        const { run, factory } = harness()
        yield* plantDatabase(factory, 3, () => {})
        const error = yield* run(store => store.entries).pipe(Effect.flip)
        expect(error.reason).toContain('newer copy of Intone')
      }),
  )

  it.effect('keeps no audio until the learner turns that on', () =>
    Effect.gen(function* () {
      const { run, files } = harness()
      expect(yield* run(store => store.settings)).toEqual({
        keepTakeAudio: false,
      })
      yield* run(store => store.keep(newTake()))
      expect(files.size).toBe(0)
    }),
  )

  it.effect(
    'keeps a take’s audio when asked, as a WAV in the clip store, and deletes it with its take',
    () =>
      Effect.gen(function* () {
        const { run, files } = harness()
        yield* run(store => store.setSettings({ keepTakeAudio: true }))
        const kept = yield* run(store => store.keep(newTake()))
        const file = audioPathOf(kept.entry.id)
        expect(kept.entry.audio).toEqual({
          file,
          sampleRate: 48_000,
          seconds: 0.1,
        })
        const wav = decodeWav(files.get(file) ?? new Uint8Array())
        expect(wav.sampleRate).toBe(48_000)
        expect(wav.channels[0]?.length).toBe(4800)
        expect(
          Math.max(
            ...(wav.channels[0] ?? []).map((sample, k) =>
              Math.abs(sample - (audio.samples[k] ?? 0)),
            ),
          ),
        ).toBeLessThan(1 / 32_768)
        const other = yield* run(store => store.keep(newTake()))
        yield* run(store => store.remove(kept.entry.id))
        expect([...files.keys()]).toEqual([audioPathOf(other.entry.id)])
        expect(
          (yield* run(store => store.entries)).entries.map(entry => entry.id),
        ).toEqual([other.entry.id])
        expect(yield* run(store => store.fullTake(kept.entry.id))).toEqual(
          Option.none(),
        )
      }),
  )

  it.effect(
    'keeps the take without its audio when the audio cannot be written',
    () =>
      Effect.gen(function* () {
        const factory = new IDBFactory()
        const failingClips = Layer.succeed(
          ClipStore,
          ClipStore.of({
            write: () =>
              Effect.fail(new ClipStoreError({ reason: 'The disk is full.' })),
            read: () => Effect.succeedNone,
            remove: () => Effect.void,
            clear: Effect.void,
          }),
        )
        const layer = Layer.effect(HistoryStore, make(factory)).pipe(
          Layer.provide(failingClips),
        )
        const kept = yield* HistoryStore.use(store =>
          store
            .setSettings({ keepTakeAudio: true })
            .pipe(Effect.andThen(store.keep(newTake()))),
        ).pipe(Effect.provide(layer))
        expect(kept.entry.audio).toBeNull()
        expect(kept.maybeAudioFailure).toEqual(Option.some('The disk is full.'))
      }),
  )

  it.effect(
    'replaces a take’s score and alignment when it is scored again',
    () =>
      Effect.gen(function* () {
        const { run } = harness()
        const kept = yield* run(store => store.keep(newTake()))
        const again: Comparison = {
          score: {
            _tag: 'CouldNotCompare',
            version: 2,
            reason: 'LengthMismatch',
          },
          alignedTakeF0: null,
        }
        yield* run(store =>
          store.rescore([{ id: kept.entry.id, comparison: again }]),
        )
        const full = yield* run(store => store.fullTake(kept.entry.id))
        expect(
          Option.map(full, ({ entry, alignedF0 }) => [entry.score, alignedF0]),
        ).toEqual(Option.some([again.score, null]))
      }),
  )

  it.effect(
    'deletes everything it keeps, native curves and audio included',
    () =>
      Effect.gen(function* () {
        const { run, files, factory } = harness()
        yield* run(store => store.setSettings({ keepTakeAudio: true }))
        yield* run(store => store.keep(newTake()))
        yield* Effect.promise(async () => {
          const database = await request(() => factory.open(databaseName))
          await putRaw(database, stores.nativeCurves, { kept: true }, 'line')
          database.close()
        })
        yield* run(store => store.clear)
        expect(files.size).toBe(0)
        expect(yield* run(store => store.entries)).toEqual({
          entries: [],
          unreadable: 0,
        })
        expect(yield* run(store => store.settings)).toEqual({
          keepTakeAudio: false,
        })
        expect((yield* readRaw(factory, stores.nativeCurves)).values).toEqual(
          [],
        )
      }),
  )

  it.effect(
    'dumps everything and restores it into another device’s history, audio only when asked',
    () =>
      Effect.gen(function* () {
        const from = harness()
        yield* from.run(store => store.setSettings({ keepTakeAudio: true }))
        const kept = yield* from.run(store => store.keep(newTake()))
        const withAudio = yield* from.run(store => store.dump(true))
        expect(withAudio.natives).toHaveLength(1)
        expect(withAudio.takes).toHaveLength(1)
        expect([...withAudio.audio.keys()]).toEqual([
          audioPathOf(kept.entry.id),
        ])
        const withoutAudio = yield* from.run(store => store.dump(false))
        expect(withoutAudio.audio.size).toBe(0)
        expect(withoutAudio.takes[0]?.entry.audio).toBeNull()

        const to = harness()
        expect(yield* to.run(store => store.restore(withAudio))).toBe(1)
        expect(yield* to.run(store => store.entries)).toEqual(
          yield* from.run(store => store.entries),
        )
        expect([...to.files.keys()]).toEqual([audioPathOf(kept.entry.id)])
        expect(yield* to.run(store => store.settings)).toEqual({
          keepTakeAudio: true,
        })
        // The same backup again adds nothing.
        yield* to.run(store => store.restore(withAudio))
        expect((yield* to.run(store => store.entries)).entries).toHaveLength(1)
      }),
  )
})
