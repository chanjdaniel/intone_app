import { Array, Context, Effect, Layer, Option, Random, Schema } from 'effect'

import { encodeWav } from '../engine/audio/wav'
import type { Recording } from '../score/score'
import { ClipStore } from './clip-store'
import {
  type HistoryDump,
  NativeEntry,
  Settings,
  TakeEntry,
  type TakeMode,
  TakeRecording,
  defaultSettings,
  historyFormat,
  recordingId,
  recordingOfStored,
  storedRecordingOf,
  storedScoreOf,
} from './history-records'
import {
  type IndexedDbError,
  deleteDatabase,
  openDatabase,
  stores,
  transact,
} from './indexed-db'
import type { Comparison } from './scorer'

// Every take kept on the device (spec, "History and storage"): its line,
// guided or blind, its date, the native's and the learner's curves and
// features, its score and the score's version, in IndexedDB through the
// app's own thin wrapper (./indexed-db.ts), each record decoded by its
// Schema on every read (./history-records.ts). A take's audio is kept
// only when the learner has turned that on, in the clip store, and goes
// with its take.

export class HistoryError extends Schema.TaggedError<
  HistoryError,
  { readonly brand: unique symbol }
>()('HistoryError', { reason: Schema.String }) {}

export type TakeAudio = Readonly<{ samples: Float32Array; sampleRate: number }>

export type NewTake = Readonly<{
  clipId: string
  lineId: string
  lineText: string
  mode: TakeMode
  takenAt: number
  day: string
  native: Recording
  take: Recording
  comparison: Comparison
  // The take's audio, kept only when the settings say so.
  audio: Option.Option<TakeAudio>
}>

export type KeptTake = Readonly<{
  entry: TakeEntry
  // Why the audio was not kept, when it was to be and could not be.
  maybeAudioFailure: Option.Option<string>
}>

// A take whole: its entry, its recording, and the native it was scored
// against.
export type FullTake = Readonly<{
  entry: TakeEntry
  take: Recording
  alignedF0: Float32Array | null
  native: Recording
}>

export type HistoryReading = Readonly<{
  entries: ReadonlyArray<TakeEntry>
  // Records that did not decode: damaged, or written by a newer app.
  unreadable: number
}>

export type Rescored = Readonly<{ id: string; comparison: Comparison }>

export type HistoryStoreShape = Readonly<{
  readonly keep: (take: NewTake) => Effect.Effect<KeptTake, HistoryError>
  readonly entries: Effect.Effect<HistoryReading, HistoryError>
  readonly fullTake: (
    id: string,
  ) => Effect.Effect<Option.Option<FullTake>, HistoryError>
  readonly rescore: (
    updates: ReadonlyArray<Rescored>,
  ) => Effect.Effect<void, HistoryError>
  // Deletes a take, its recording and its kept audio.
  readonly remove: (id: string) => Effect.Effect<void, HistoryError>
  readonly settings: Effect.Effect<Settings, HistoryError>
  readonly setSettings: (
    settings: Settings,
  ) => Effect.Effect<void, HistoryError>
  readonly dump: (
    withAudio: boolean,
  ) => Effect.Effect<HistoryDump, HistoryError>
  // How many takes the backup held.
  readonly restore: (backup: HistoryDump) => Effect.Effect<number, HistoryError>
  // Deletes everything the app keeps on the device: the database, with
  // the history and the native curves, and every kept file.
  readonly clear: Effect.Effect<void, HistoryError>
}>

const settingsKey = 'settings'

// The values `pick` finds in `items`.
const filterSome = <A, B>(
  items: Iterable<A>,
  pick: (item: A) => Option.Option<B>,
): Array<B> =>
  Array.getSomes(Array.map(Array.fromIterable(items), item => pick(item)))

export const audioPathOf = (id: string): string => `takes/${id}.wav`

const decodeEntry = Schema.decodeUnknownOption(TakeEntry)
const decodeRecording = Schema.decodeUnknownOption(TakeRecording)
const decodeNative = Schema.decodeUnknownOption(NativeEntry)
const decodeSettings = Schema.decodeUnknownOption(Settings)

const failWith =
  (lead: string) =>
  (error: Readonly<{ reason: string }>): HistoryError =>
    new HistoryError({ reason: `${lead} ${error.reason}` })

const hex = (value: number): string => value.toString(16).padStart(8, '0')

// A new take's id: its time, then 64 random bits.
const newTakeId = (takenAt: number): Effect.Effect<string> =>
  Effect.all([
    Random.nextIntBetween(0, 0xffffffff),
    Random.nextIntBetween(0, 0xffffffff),
  ]).pipe(Effect.map(([a, b]) => `${takenAt.toString(36)}-${hex(a)}${hex(b)}`))

const wavOf = (audio: TakeAudio): Uint8Array =>
  encodeWav({
    sampleRate: audio.sampleRate,
    encoding: 'pcm16',
    channels: [audio.samples],
  })

// The history, on the IndexedDB of `factory`, its audio in the clip
// store. Each read or write opens the database and closes it after, so
// no connection stays open to hold up an upgrade or a deletion.
export const make = (
  factory: IDBFactory,
): Effect.Effect<HistoryStoreShape, never, ClipStore> =>
  Effect.gen(function* () {
    const clips = yield* ClipStore

    const withDatabase = <A>(
      lead: string,
      use: (database: IDBDatabase) => Effect.Effect<A, IndexedDbError>,
    ): Effect.Effect<A, HistoryError> =>
      Effect.scoped(openDatabase(factory).pipe(Effect.flatMap(use))).pipe(
        Effect.mapError(failWith(lead)),
      )

    const readAll = <A>(
      database: IDBDatabase,
      store:
        | typeof stores.takes
        | typeof stores.takeRecordings
        | typeof stores.natives,
      decode: (value: unknown) => Option.Option<A>,
    ) =>
      transact(database, [store], 'readonly', transaction => {
        const request = transaction.objectStore(store).getAll()
        return () => {
          const values: ReadonlyArray<unknown> = request.result
          const decoded = filterSome(values, value => decode(value))
          return { decoded, unreadable: values.length - decoded.length }
        }
      })

    const settings = withDatabase('The settings could not be read.', database =>
      transact(database, [stores.meta], 'readonly', transaction => {
        const request = transaction.objectStore(stores.meta).get(settingsKey)
        return () =>
          Option.getOrElse(
            decodeSettings(request.result),
            () => defaultSettings,
          )
      }),
    )

    const keep = (newTake: NewTake): Effect.Effect<KeptTake, HistoryError> =>
      Effect.gen(function* () {
        const id = yield* newTakeId(newTake.takenAt)
        const { keepTakeAudio } = yield* settings
        const audioFile = audioPathOf(id)
        const toKeep = Option.filter(newTake.audio, () => keepTakeAudio)
        const audioKept: Option.Option<string> | null = Option.isSome(toKeep)
          ? yield* clips.write(audioFile, wavOf(toKeep.value)).pipe(
              Effect.as(Option.none<string>()),
              Effect.catch(error => Effect.succeedSome(error.reason)),
            )
          : null
        const keptAudio = Option.filter(
          toKeep,
          () => audioKept !== null && Option.isNone(audioKept),
        )
        const hasAudio = Option.isSome(keptAudio)
        const nativeId = recordingId(newTake.native)
        const entry: TakeEntry = {
          format: historyFormat,
          id,
          clipId: newTake.clipId,
          lineId: newTake.lineId,
          lineText: newTake.lineText,
          mode: newTake.mode,
          takenAt: newTake.takenAt,
          day: newTake.day,
          nativeId,
          score: storedScoreOf(newTake.comparison.score),
          audio: Option.match(keptAudio, {
            onNone: () => null,
            onSome: ({ samples, sampleRate }) => ({
              file: audioFile,
              sampleRate,
              seconds: samples.length / sampleRate,
            }),
          }),
        }
        const recording: TakeRecording = {
          format: historyFormat,
          id,
          take: storedRecordingOf(newTake.take),
          alignedF0: newTake.comparison.alignedTakeF0,
        }
        const native: NativeEntry = {
          format: historyFormat,
          id: nativeId,
          recording: storedRecordingOf(newTake.native),
        }
        yield* withDatabase('The take was not kept.', database =>
          transact(
            database,
            [stores.takes, stores.takeRecordings, stores.natives],
            'readwrite',
            transaction => {
              transaction.objectStore(stores.natives).put(native)
              transaction.objectStore(stores.takes).put(entry)
              transaction.objectStore(stores.takeRecordings).put(recording)
              return () => undefined
            },
          ),
        ).pipe(
          Effect.tapError(() =>
            hasAudio
              ? clips.remove(audioFile).pipe(Effect.ignore)
              : Effect.void,
          ),
        )
        return { entry, maybeAudioFailure: audioKept ?? Option.none() }
      })

    const entries = withDatabase('The history could not be read.', database =>
      readAll(database, stores.takes, decodeEntry).pipe(
        Effect.map(({ decoded, unreadable }) => ({
          entries: decoded,
          unreadable,
        })),
      ),
    )

    const fullTake = (id: string) =>
      withDatabase('The take could not be read.', database =>
        transact(
          database,
          [stores.takes, stores.takeRecordings],
          'readonly',
          transaction => {
            const entry = transaction.objectStore(stores.takes).get(id)
            const recording = transaction
              .objectStore(stores.takeRecordings)
              .get(id)
            return () => ({ entry: entry.result, recording: recording.result })
          },
        ).pipe(
          Effect.flatMap(({ entry, recording }) =>
            Option.match(
              Option.all({
                entry: decodeEntry(entry),
                recording: decodeRecording(recording),
              }),
              {
                onNone: () => Effect.succeedNone,
                onSome: found =>
                  transact(
                    database,
                    [stores.natives],
                    'readonly',
                    transaction => {
                      const native = transaction
                        .objectStore(stores.natives)
                        .get(found.entry.nativeId)
                      return () =>
                        Option.map(
                          decodeNative(native.result),
                          (nativeEntry): FullTake => ({
                            entry: found.entry,
                            take: recordingOfStored(found.recording.take),
                            alignedF0: found.recording.alignedF0,
                            native: recordingOfStored(nativeEntry.recording),
                          }),
                        )
                    },
                  ),
              },
            ),
          ),
        ),
      )

    // Writes each take's new score and alignment, all or none.
    const rescore = (updates: ReadonlyArray<Rescored>) =>
      withDatabase('The new scores were not kept.', database =>
        transact(
          database,
          [stores.takes, stores.takeRecordings],
          'readwrite',
          transaction => {
            const takes = transaction.objectStore(stores.takes)
            const recordings = transaction.objectStore(stores.takeRecordings)
            updates.forEach(({ id, comparison }) => {
              const entry = takes.get(id)
              const recording = recordings.get(id)
              entry.onsuccess = () =>
                Option.map(decodeEntry(entry.result), found =>
                  takes.put({
                    ...found,
                    score: storedScoreOf(comparison.score),
                  }),
                )
              recording.onsuccess = () =>
                Option.map(decodeRecording(recording.result), found =>
                  recordings.put({
                    ...found,
                    alignedF0: comparison.alignedTakeF0,
                  }),
                )
            })
            return () => undefined
          },
        ),
      )

    const remove = (id: string) =>
      withDatabase('The take was not deleted.', database =>
        transact(
          database,
          [stores.takes, stores.takeRecordings],
          'readwrite',
          transaction => {
            const takes = transaction.objectStore(stores.takes)
            const entry = takes.get(id)
            takes.delete(id)
            transaction.objectStore(stores.takeRecordings).delete(id)
            return () =>
              Option.flatMap(decodeEntry(entry.result), found =>
                Option.fromNullishOr(found.audio),
              )
          },
        ),
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: audio =>
              clips
                .remove(audio.file)
                .pipe(
                  Effect.mapError(
                    failWith('The take’s audio was not deleted.'),
                  ),
                ),
          }),
        ),
      )

    const setSettings = (next: Settings) =>
      withDatabase('The settings were not kept.', database =>
        transact(database, [stores.meta], 'readwrite', transaction => {
          transaction.objectStore(stores.meta).put(next, settingsKey)
          return () => undefined
        }),
      )

    const dump = (withAudio: boolean) =>
      Effect.gen(function* () {
        const read = yield* withDatabase(
          'The history could not be read.',
          database =>
            Effect.all({
              takes: readAll(database, stores.takes, decodeEntry),
              recordings: readAll(
                database,
                stores.takeRecordings,
                decodeRecording,
              ),
              natives: readAll(database, stores.natives, decodeNative),
            }),
        )
        const recordingById = new Map(
          read.recordings.decoded.map(recording => [recording.id, recording]),
        )
        const takes = filterSome(read.takes.decoded, entry =>
          Option.map(
            Option.fromNullishOr(recordingById.get(entry.id)),
            recording => ({
              entry,
              recording,
            }),
          ),
        )
        const audioFiles = withAudio
          ? filterSome(takes, ({ entry }) => Option.fromNullishOr(entry.audio))
          : []
        const audio = yield* Effect.forEach(audioFiles, ({ file }) =>
          clips.read(file).pipe(Effect.map(bytes => [file, bytes] as const)),
        ).pipe(Effect.mapError(failWith('The kept audio could not be read.')))
        return {
          settings: yield* settings,
          natives: read.natives.decoded,
          // A take whose audio was left out of the backup keeps no
          // reference to it.
          takes: withAudio
            ? takes
            : takes.map(take => ({
                entry: { ...take.entry, audio: null },
                recording: take.recording,
              })),
          audio: new Map(
            filterSome(audio, ([file, bytes]) =>
              Option.map(bytes, found => [file, found] as const),
            ),
          ),
        } satisfies HistoryDump
      })

    // Adds a backup's takes to the history, all in one transaction, and
    // then its audio; a take already here (the same id) is replaced.
    const restore = (backup: HistoryDump) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          [...backup.audio],
          ([file, bytes]) => clips.write(file, Uint8Array.from(bytes)),
          { discard: true },
        ).pipe(
          Effect.mapError(failWith('The backup’s audio was not restored.')),
        )
        yield* withDatabase('The backup was not restored.', database =>
          transact(
            database,
            [stores.takes, stores.takeRecordings, stores.natives, stores.meta],
            'readwrite',
            transaction => {
              backup.natives.forEach(native =>
                transaction.objectStore(stores.natives).put(native),
              )
              backup.takes.forEach(({ entry, recording }) => {
                transaction.objectStore(stores.takes).put(entry)
                transaction.objectStore(stores.takeRecordings).put(recording)
              })
              transaction
                .objectStore(stores.meta)
                .put(backup.settings, settingsKey)
              return () => undefined
            },
          ),
        )
        return backup.takes.length
      })

    const clear = Effect.all(
      [
        deleteDatabase(factory).pipe(
          Effect.mapError(failWith('The history was not deleted.')),
        ),
        clips.clear.pipe(
          Effect.mapError(failWith('The kept audio was not deleted.')),
        ),
      ],
      { discard: true },
    )

    return {
      keep,
      entries,
      fullTake,
      rescore,
      remove,
      settings,
      setSettings,
      dump,
      restore,
      clear,
    }
  })

export class HistoryStore extends Context.Service<
  HistoryStore,
  HistoryStoreShape
>()('intone/services/HistoryStore') {
  // The browser's IndexedDB and origin private file system.
  static readonly layer = Layer.effect(
    HistoryStore,
    Effect.suspend(() => make(indexedDB)),
  ).pipe(Layer.provide(ClipStore.layer))

  // The IndexedDB of `factory` (an in-memory one, in tests) with the clip
  // store's map in memory, `files`.
  static readonly layerTest = (
    factory: IDBFactory,
    files: Map<string, Uint8Array>,
  ): Layer.Layer<HistoryStore> =>
    Layer.effect(HistoryStore, make(factory)).pipe(
      Layer.provide(ClipStore.layerMemory(files)),
    )
}
