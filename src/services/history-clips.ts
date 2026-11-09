import { Array, Effect, Option, Order, Random, Schema } from 'effect'

import type { Recording } from '../score/score'
import type { ClipStore } from './clip-store'
import {
  ClipEntry,
  type ClipLine,
  type LineNative,
  NativeEntry,
  TakeEntry,
  historyFormat,
  recordingId,
  recordingOfStored,
  storedRecordingOf,
} from './history-records'
import type { HistoryError } from './history-store'
import { type IndexedDbError, stores, transact } from './indexed-db'

// The clips the learner brought, as the history keeps them
// (./history-store.ts): each clip's entry, with its lines, in `clips`;
// each line's native curve in `natives`, by its content, as a take's
// native is; and the clip's file in the clip store. A clip is deleted
// with everything of it: its lines, their curves, its takes and their
// kept audio, and its file.

// A line as the clip analyser cut it (./clip-analyser.ts): seconds from
// the clip's start, and its native curve and features or why it has
// none.
export type NewClipLine = Readonly<{
  from: number
  to: number
  native:
    | Readonly<{ _tag: 'Tracked'; recording: Recording }>
    | Readonly<{ _tag: 'TooQuiet' | 'TooNoisy' }>
}>

export type NewClip = Readonly<{
  // The file's own name, and its media type as the browser named it.
  name: string
  type: string
  addedAt: number
  seconds: number
  // The file itself, handed over: the caller must not use it again.
  bytes: Uint8Array
  lines: ReadonlyArray<NewClipLine>
}>

// A line of a kept clip, with what practising it needs.
export type FoundClipLine = Readonly<{
  clip: ClipEntry
  line: ClipLine
  // Its native curve and features; none when it has none, or its record
  // did not decode.
  maybeNative: Option.Option<Recording>
}>

export type ClipReading = Readonly<{
  clips: ReadonlyArray<ClipEntry>
  // Records that did not decode: damaged, or written by a newer app.
  unreadable: number
}>

export type ClipOperations = Readonly<{
  readonly addClip: (clip: NewClip) => Effect.Effect<ClipEntry, HistoryError>
  readonly clips: Effect.Effect<ClipReading, HistoryError>
  readonly clip: (
    id: string,
  ) => Effect.Effect<Option.Option<ClipEntry>, HistoryError>
  readonly clipLine: (
    clipId: string,
    lineId: string,
  ) => Effect.Effect<Option.Option<FoundClipLine>, HistoryError>
  // Deletes a clip with all its lines, their curves, its takes and its
  // files.
  readonly removeClip: (id: string) => Effect.Effect<void, HistoryError>
}>

export type WithDatabase = <A>(
  lead: string,
  use: (database: IDBDatabase) => Effect.Effect<A, IndexedDbError>,
) => Effect.Effect<A, HistoryError>

const decodeClip = Schema.decodeUnknownOption(ClipEntry)
const decodeEntry = Schema.decodeUnknownOption(TakeEntry)
const decodeNative = Schema.decodeUnknownOption(NativeEntry)

const newestFirst = Order.flip(
  Order.mapInput(Order.Number, (clip: ClipEntry) => clip.addedAt),
)

const hex = (value: number): string => value.toString(16).padStart(8, '0')

// A new clip's id: its time, then 64 random bits.
const newClipId = (addedAt: number): Effect.Effect<string> =>
  Effect.all([
    Random.nextIntBetween(0, 0xffffffff),
    Random.nextIntBetween(0, 0xffffffff),
  ]).pipe(Effect.map(([a, b]) => `${addedAt.toString(36)}-${hex(a)}${hex(b)}`))

// Where a clip's file is kept: by its id, with the file's own extension
// when it has a plain one.
export const clipAudioPathOf = (id: string, name: string): string => {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase()
  return `clips/${id}.${extension ?? 'audio'}`
}

const nativeOf = (native: NewClipLine['native']): LineNative =>
  native._tag === 'Tracked'
    ? { _tag: 'Tracked', nativeId: recordingId(native.recording) }
    : { _tag: native._tag }

export const makeClipOperations = (
  withDatabase: WithDatabase,
  files: ClipStore['Service'],
  failWith: (
    lead: string,
  ) => (error: Readonly<{ reason: string }>) => HistoryError,
): ClipOperations => {
  const addClip = (clip: NewClip) =>
    Effect.gen(function* () {
      const id = yield* newClipId(clip.addedAt)
      const file = clipAudioPathOf(id, clip.name)
      const bytes = clip.bytes.length
      yield* files
        .write(file, clip.bytes)
        .pipe(Effect.mapError(failWith('The clip’s audio was not kept.')))
      const entry: ClipEntry = {
        format: historyFormat,
        id,
        name: clip.name,
        addedAt: clip.addedAt,
        seconds: clip.seconds,
        audio: { file, type: clip.type, bytes },
        lines: clip.lines.map((line, k) => ({
          id: String(k + 1),
          from: line.from,
          to: line.to,
          native: nativeOf(line.native),
        })),
      }
      const natives = Array.getSomes(
        clip.lines.map(({ native }) =>
          native._tag === 'Tracked'
            ? Option.some<NativeEntry>({
                format: historyFormat,
                id: recordingId(native.recording),
                recording: storedRecordingOf(native.recording),
              })
            : Option.none(),
        ),
      )
      yield* withDatabase('The clip was not kept.', database =>
        transact(
          database,
          [stores.clips, stores.natives],
          'readwrite',
          transaction => {
            natives.forEach(native =>
              transaction.objectStore(stores.natives).put(native),
            )
            transaction.objectStore(stores.clips).put(entry)
            return () => undefined
          },
        ),
      ).pipe(Effect.tapError(() => files.remove(file).pipe(Effect.ignore)))
      return entry
    })

  const clips = withDatabase('The clips could not be read.', database =>
    transact(database, [stores.clips], 'readonly', transaction => {
      const request = transaction.objectStore(stores.clips).getAll()
      return () => {
        const values: ReadonlyArray<unknown> = request.result
        const decoded = Array.getSomes(values.map(value => decodeClip(value)))
        return {
          clips: Array.sort(decoded, newestFirst),
          unreadable: values.length - decoded.length,
        }
      }
    }),
  )

  const clip = (id: string) =>
    withDatabase('The clip could not be read.', database =>
      transact(database, [stores.clips], 'readonly', transaction => {
        const request = transaction.objectStore(stores.clips).get(id)
        return () => decodeClip(request.result)
      }),
    )

  const clipLine = (clipId: string, lineId: string) =>
    withDatabase('The line could not be read.', database =>
      transact(database, [stores.clips], 'readonly', transaction => {
        const request = transaction.objectStore(stores.clips).get(clipId)
        return () => decodeClip(request.result)
      }).pipe(
        Effect.flatMap(maybeClip => {
          const maybeFound = Option.flatMap(maybeClip, found =>
            Option.map(
              Array.findFirst(found.lines, line => line.id === lineId),
              line => ({ clip: found, line }),
            ),
          )
          if (Option.isNone(maybeFound)) {
            return Effect.succeedNone
          }
          const { clip: found, line } = maybeFound.value
          if (line.native._tag !== 'Tracked') {
            return Effect.succeedSome<FoundClipLine>({
              clip: found,
              line,
              maybeNative: Option.none(),
            })
          }
          const nativeId = line.native.nativeId
          return transact(
            database,
            [stores.natives],
            'readonly',
            transaction => {
              const request = transaction
                .objectStore(stores.natives)
                .get(nativeId)
              return () =>
                Option.some<FoundClipLine>({
                  clip: found,
                  line,
                  maybeNative: Option.map(decodeNative(request.result), entry =>
                    recordingOfStored(entry.recording),
                  ),
                })
            },
          )
        }),
      ),
    )

  const removeClip = (id: string) =>
    withDatabase('The clip was not deleted.', database =>
      transact(
        database,
        [stores.clips, stores.takes, stores.takeRecordings, stores.natives],
        'readwrite',
        transaction => {
          const clipStore = transaction.objectStore(stores.clips)
          const takeStore = transaction.objectStore(stores.takes)
          const allClips = clipStore.getAll()
          const allTakes = takeStore.getAll()
          const removed: Array<string> = []
          allTakes.onsuccess = () => {
            const clipValues: ReadonlyArray<unknown> = allClips.result
            const takeValues: ReadonlyArray<unknown> = allTakes.result
            const everyClip = Array.getSomes(
              clipValues.map(value => decodeClip(value)),
            )
            const everyTake = Array.getSomes(
              takeValues.map(value => decodeEntry(value)),
            )
            const itsTakes = everyTake.filter(take => take.clipId === id)
            const otherTakes = everyTake.filter(take => take.clipId !== id)
            const itsClips = everyClip.filter(found => found.id === id)
            const otherClips = everyClip.filter(found => found.id !== id)
            const nativesOf = (lines: ReadonlyArray<ClipLine>) =>
              lines.flatMap(line =>
                line.native._tag === 'Tracked' ? [line.native.nativeId] : [],
              )
            const kept = new Set([
              ...otherTakes.map(take => take.nativeId),
              ...otherClips.flatMap(other => nativesOf(other.lines)),
            ])
            const unused = new Set(
              [
                ...itsTakes.map(take => take.nativeId),
                ...itsClips.flatMap(found => nativesOf(found.lines)),
              ].filter(nativeId => !kept.has(nativeId)),
            )
            itsTakes.forEach(take => {
              takeStore.delete(take.id)
              transaction.objectStore(stores.takeRecordings).delete(take.id)
              if (take.audio !== null) {
                removed.push(take.audio.file)
              }
            })
            unused.forEach(nativeId =>
              transaction.objectStore(stores.natives).delete(nativeId),
            )
            itsClips.forEach(found => {
              if (found.audio !== null) {
                removed.push(found.audio.file)
              }
            })
            clipStore.delete(id)
          }
          return () => removed
        },
      ),
    ).pipe(
      Effect.flatMap(removed =>
        Effect.forEach(removed, file => files.remove(file), {
          discard: true,
        }).pipe(Effect.mapError(failWith('The clip’s audio was not deleted.'))),
      ),
    )

  return { addClip, clips, clip, clipLine, removeClip }
}
