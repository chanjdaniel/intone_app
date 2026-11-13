import { Array, Effect, Option, Order, Random, Schema } from 'effect'

import type { Recording } from '../score/score'
import { type LineEdit, planEdit, undoneOf } from './clip-edits'
import type { ClipStore } from './clip-store'
import {
  ClipEntry,
  type ClipLine,
  type ClipTranscript,
  type LineNative,
  type LineQuality,
  NativeEntry,
  TakeEntry,
  clipAudioFiles,
  clipNativeIds,
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
// kept audio, and its file. Its lines can be changed (./clip-edits.ts):
// the lines a change moves are tracked again before anything is written,
// the clip's entry is rewritten only if no one else changed it meanwhile,
// and the last change can be undone once, so the curves of the lines
// before it are kept until then; a curve nothing names any more, no
// clip's lines, no undo and no take, is deleted.

// A line as the clip analyser cut it (./clip-analyser.ts): seconds from
// the clip's start, and its native curve and features or why it has
// none.
export type NewClipLine = Readonly<{
  from: number
  to: number
  native:
    | Readonly<{
        _tag: 'Tracked'
        recording: Recording
        quality: LineQuality
      }>
    | Readonly<{ _tag: 'TooQuiet' | 'TooNoisy' }>
}>

// Tracks the lines at `spans`, seconds from the clip's start, as a cut
// does: the line editor's clip Worker (./clip-analyser.ts, `edit`).
export type TrackSpans<E> = (
  spans: ReadonlyArray<Readonly<{ from: number; to: number }>>,
) => Effect.Effect<ReadonlyArray<NewClipLine>, E>

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
  // Changes clip `clipId`'s lines by `edit`, the lines it moves tracked
  // again by `track`, and gives the clip as it is then: unchanged when
  // the edit changes nothing, none when there is no such clip.
  readonly editClipLines: <E>(
    clipId: string,
    edit: LineEdit,
    track: TrackSpans<E>,
  ) => Effect.Effect<Option.Option<ClipEntry>, HistoryError | E>
  // Undoes clip `clipId`'s last change, and gives the clip as it is then.
  readonly undoClipEdit: (
    clipId: string,
  ) => Effect.Effect<Option.Option<ClipEntry>, HistoryError>
  // Writes `next` over `before` (none: there must be no such clip yet),
  // unless the clip was changed meanwhile, with `natives` and the files
  // in `writes`; then deletes the curves and the
  // files `before` named that nothing names any more. A local pack's
  // import (./local-pack.ts) plans what to write.
  // Keeps an upload's transcript, over any it had, and gives the clip
  // as it is then; none when there is no such clip.
  readonly setClipTranscript: (
    clipId: string,
    transcript: ClipTranscript,
  ) => Effect.Effect<Option.Option<ClipEntry>, HistoryError>
  // Gives each line named its text, the learner's own, typed or pasted,
  // which stands over the transcript's; the clip as it is then.
  readonly setLineTexts: (
    clipId: string,
    texts: ReadonlyArray<Readonly<{ lineId: string; text: string }>>,
  ) => Effect.Effect<Option.Option<ClipEntry>, HistoryError>
  readonly replaceClip: (
    before: Option.Option<ClipEntry>,
    next: ClipEntry,
    natives: ReadonlyArray<NativeEntry>,
    writes: ReadonlyArray<ClipFileWrite>,
  ) => Effect.Effect<ClipEntry, HistoryError>
}>

// A file to keep in the clip store, read only when it is written.
export type ClipFileWrite = Readonly<{ file: string; blob: Blob }>

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

// A line of a clip as kept, from what the cut or a track made of it.
const clipLineOf = (
  id: string,
  span: Readonly<{ from: number; to: number }>,
  native: NewClipLine['native'],
): ClipLine =>
  native._tag === 'Tracked'
    ? {
        id,
        from: span.from,
        to: span.to,
        native: nativeOf(native),
        quality: native.quality,
      }
    : { id, from: span.from, to: span.to, native: nativeOf(native) }

const nativeEntriesOf = (
  lines: ReadonlyArray<NewClipLine>,
): ReadonlyArray<NativeEntry> =>
  Array.getSomes(
    lines.map(({ native }) =>
      native._tag === 'Tracked'
        ? Option.some<NativeEntry>({
            format: historyFormat,
            id: recordingId(native.recording),
            recording: storedRecordingOf(native.recording),
          })
        : Option.none(),
    ),
  )

// Two readings of a clip are the same clip: both decoded by its Schema,
// so their keys are in the same order.
const sameClip = (a: ClipEntry, b: ClipEntry): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

// In `transaction`, once its earlier writes are made: deletes each of
// `candidates` that no clip's records and no take name.
const deleteUnusedNatives = (
  transaction: IDBTransaction,
  candidates: ReadonlySet<string>,
): void => {
  if (candidates.size === 0) {
    return
  }
  const allClips = transaction.objectStore(stores.clips).getAll()
  const allTakes = transaction.objectStore(stores.takes).getAll()
  allTakes.onsuccess = () => {
    const clipValues: ReadonlyArray<unknown> = allClips.result
    const takeValues: ReadonlyArray<unknown> = allTakes.result
    const named = new Set([
      ...Array.getSomes(clipValues.map(value => decodeClip(value))).flatMap(
        clipNativeIds,
      ),
      ...Array.getSomes(takeValues.map(value => decodeEntry(value))).map(
        take => take.nativeId,
      ),
    ])
    candidates.forEach(nativeId => {
      if (!named.has(nativeId)) {
        transaction.objectStore(stores.natives).delete(nativeId)
      }
    })
  }
}

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
        lines: clip.lines.map((line, k) =>
          clipLineOf(String(k + 1), line, line.native),
        ),
      }
      const natives = nativeEntriesOf(clip.lines)
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
            const kept = new Set([
              ...otherTakes.map(take => take.nativeId),
              ...otherClips.flatMap(clipNativeIds),
            ])
            const unused = new Set(
              [
                ...itsTakes.map(take => take.nativeId),
                ...itsClips.flatMap(clipNativeIds),
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
              removed.push(...clipAudioFiles(found).map(audio => audio.file))
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

  const replaceClip = (
    before: Option.Option<ClipEntry>,
    next: ClipEntry,
    natives: ReadonlyArray<NativeEntry>,
    writes: ReadonlyArray<ClipFileWrite>,
    lead = 'The clip was not kept.',
  ) =>
    Effect.gen(function* () {
      const beforeFiles = new Set(
        Option.match(before, {
          onNone: () => [],
          onSome: clipAudioFiles,
        }).map(audio => audio.file),
      )
      const nextFiles = new Set(clipAudioFiles(next).map(audio => audio.file))
      yield* Effect.forEach(writes, ({ file, blob }) =>
        Effect.tryPromise({
          try: async () => new Uint8Array(await blob.arrayBuffer()),
          catch: error => ({
            reason: `A file could not be read: ${error instanceof Error ? error.message : String(error)}`,
          }),
        }).pipe(Effect.flatMap(bytes => files.write(file, bytes))),
      ).pipe(Effect.mapError(failWith(lead)))
      const isWritten = yield* withDatabase(lead, database =>
        transact(
          database,
          [stores.clips, stores.natives, stores.takes],
          'readwrite',
          transaction => {
            const clipStore = transaction.objectStore(stores.clips)
            const current = clipStore.get(next.id)
            const outcome = { written: false }
            current.onsuccess = () => {
              const found = decodeClip(current.result)
              const unchanged = Option.match(before, {
                onNone: () => current.result === undefined,
                onSome: was =>
                  Option.isSome(found) && sameClip(found.value, was),
              })
              if (!unchanged) {
                return
              }
              natives.forEach(native =>
                transaction.objectStore(stores.natives).put(native),
              )
              clipStore.put(next)
              outcome.written = true
              const named = new Set(clipNativeIds(next))
              deleteUnusedNatives(
                transaction,
                new Set(
                  Option.match(before, {
                    onNone: () => [],
                    onSome: clipNativeIds,
                  }).filter(nativeId => !named.has(nativeId)),
                ),
              )
            }
            return () => outcome.written
          },
        ),
      )
      if (!isWritten) {
        return yield* failWith(lead)({
          reason:
            'The clip was changed or deleted elsewhere, perhaps in another tab. Open it again.',
        })
      }
      yield* Effect.forEach(
        [...beforeFiles].filter(file => !nextFiles.has(file)),
        file => files.remove(file),
      ).pipe(Effect.ignore)
      return next
    }).pipe(
      // A file this wrote that `before` did not name goes again.
      Effect.tapError(() =>
        Effect.forEach(
          writes.filter(
            ({ file }) =>
              !Option.exists(before, was =>
                clipAudioFiles(was).some(audio => audio.file === file),
              ),
          ),
          ({ file }) => files.remove(file),
        ).pipe(Effect.ignore),
      ),
    )

  const editClipLines = <E>(
    clipId: string,
    edit: LineEdit,
    track: TrackSpans<E>,
  ): Effect.Effect<Option.Option<ClipEntry>, HistoryError | E> =>
    Effect.gen(function* () {
      const maybeClip = yield* clip(clipId)
      if (Option.isNone(maybeClip)) {
        return Option.none()
      }
      const before = maybeClip.value
      // A pack's lines change only by importing its manifest again.
      const maybePlan =
        before.pack === undefined ? planEdit(before, edit) : Option.none()
      if (Option.isNone(maybePlan)) {
        return maybeClip
      }
      const plan = maybePlan.value
      const spans = plan.lines.flatMap(line =>
        line._tag === 'Retrack' ? [{ from: line.from, to: line.to }] : [],
      )
      const tracked = Array.isArrayNonEmpty(spans) ? yield* track(spans) : []
      if (tracked.length !== spans.length) {
        return yield* failWith('The lines were not changed.')({
          reason: `${spans.length} lines were to be tracked again, and ${tracked.length} were.`,
        })
      }
      const queue = [...tracked]
      // A moved line keeps the text the learner gave it; a split or merge
      // makes new words of a line, so it takes the transcript's.
      const givenTexts = new Map(
        edit._tag === 'Move'
          ? before.lines.flatMap(line =>
              line.text === undefined ? [] : [[line.id, line.text] as const],
            )
          : [],
      )
      const lines = plan.lines.map(line => {
        if (line._tag === 'Kept') {
          return line.line
        }
        const made = queue.shift()
        const retracked = clipLineOf(
          line.id,
          line,
          made?.native ?? { _tag: 'TooQuiet' },
        )
        const text = givenTexts.get(line.id)
        return text === undefined ? retracked : { ...retracked, text }
      })
      const next: ClipEntry = {
        format: before.format,
        id: before.id,
        name: before.name,
        addedAt: before.addedAt,
        seconds: before.seconds,
        audio: before.audio,
        lines,
        nextLineId: plan.nextLineId,
        undo: plan.undo,
        ...(before.transcript === undefined
          ? {}
          : { transcript: before.transcript }),
      }
      return Option.some(
        yield* replaceClip(
          Option.some(before),
          next,
          nativeEntriesOf(tracked),
          [],
          'The lines were not changed.',
        ),
      )
    })

  const undoClipEdit = (clipId: string) =>
    Effect.gen(function* () {
      const maybeClip = yield* clip(clipId)
      if (Option.isNone(maybeClip)) {
        return Option.none()
      }
      const before = maybeClip.value
      const maybeUndone = undoneOf(before)
      if (Option.isNone(maybeUndone)) {
        return maybeClip
      }
      return Option.some(
        yield* replaceClip(
          Option.some(before),
          maybeUndone.value,
          [],
          [],
          'The change was not undone.',
        ),
      )
    })

  // `change` of the clip as it is, written unless it changed meanwhile.
  const changeClip = (
    clipId: string,
    change: (clip: ClipEntry) => ClipEntry,
    lead: string,
  ) =>
    Effect.gen(function* () {
      const maybeClip = yield* clip(clipId)
      if (Option.isNone(maybeClip)) {
        return Option.none()
      }
      return Option.some(
        yield* replaceClip(maybeClip, change(maybeClip.value), [], [], lead),
      )
    })

  const setClipTranscript = (clipId: string, transcript: ClipTranscript) =>
    changeClip(
      clipId,
      before => ({ ...before, transcript }),
      'The text was not kept.',
    )

  const setLineTexts = (
    clipId: string,
    texts: ReadonlyArray<Readonly<{ lineId: string; text: string }>>,
  ) => {
    const given = new Map(texts.map(({ lineId, text }) => [lineId, text]))
    return changeClip(
      clipId,
      before => ({
        ...before,
        lines: before.lines.map(line => {
          const text = given.get(line.id)
          return text === undefined ? line : { ...line, text }
        }),
      }),
      'The text was not kept.',
    )
  }

  return {
    addClip,
    clips,
    clip,
    clipLine,
    removeClip,
    editClipLines,
    undoClipEdit,
    setClipTranscript,
    setLineTexts,
    replaceClip: (before, next, natives, writes) =>
      replaceClip(before, next, natives, writes),
  }
}
