import { Effect, Option, Schema, SchemaTransformation } from 'effect'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { decodeWav } from '../engine/audio/wav'
import {
  ClipEntry,
  Frames,
  type HistoryDump,
  Settings,
  TakeEntry,
  clipAudioFiles,
  clipNativeIds,
  historyFormat,
  nativeEntryOf,
  takeRecordingOf,
} from './history-records'

// The backup: one zip file the learner saves on their own device, with
// `history.json` (every take, every native it was scored against, the
// clips the learner brought and their lines, the settings) and, only
// when the learner asks, the audio: an `audio/` folder of the takes'
// kept audio and a `clips/` folder of the clips' files. It is read back through the same Schemas as the
// history's own records (./history-records.ts), so a file that is not a
// backup, or a damaged one, is refused whole and nothing is restored.
// This module is loaded only when a backup is made or read, with the zip
// code it needs.

export class BackupError extends Schema.TaggedError<
  BackupError,
  { readonly brand: unique symbol }
>()('BackupError', { reason: Schema.String }) {}

export const historyFile = 'history.json'

// Frames as text: the Float32 values' little-endian bytes in base64, so
// each value comes back exactly.
const FramesFromBase64 = Schema.Uint8ArrayFromBase64.check(
  Schema.makeFilter(
    (bytes: Uint8Array) =>
      bytes.length % 4 === 0 || 'is not a whole number of frames',
  ),
).pipe(
  Schema.decodeTo(
    Frames,
    SchemaTransformation.transform({
      decode: (bytes: Uint8Array): Float32Array<ArrayBufferLike> => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length)
        return Float32Array.from({ length: bytes.length / 4 }, (_, k) =>
          view.getFloat32(k * 4, true),
        )
      },
      encode: (frames: Float32Array<ArrayBufferLike>): Uint8Array => {
        const bytes = new Uint8Array(frames.length * 4)
        const view = new DataView(bytes.buffer)
        frames.forEach((value, k) => view.setFloat32(k * 4, value, true))
        return bytes
      },
    }),
  ),
)

export const BackupFile = Schema.Struct({
  app: Schema.Literal('intone'),
  kind: Schema.Literal('history backup'),
  format: Schema.Literal(historyFormat),
  // Milliseconds since 1970.
  exportedAt: Schema.Finite,
  settings: Settings,
  natives: Schema.Array(nativeEntryOf(FramesFromBase64)),
  takes: Schema.Array(
    Schema.Struct({
      entry: TakeEntry,
      recording: takeRecordingOf(FramesFromBase64),
    }),
  ),
  // A backup made before clips could be brought has none.
  clips: Schema.optionalKey(Schema.Array(ClipEntry)),
})
export type BackupFile = typeof BackupFile.Type

const BackupJson = Schema.fromJsonString(BackupFile)
const encodeJson = Schema.encodeSync(BackupJson)
const decodeJson = Schema.decodeUnknownExit(BackupJson)

const audioFolder = 'audio/'
const audioName = /^[A-Za-z0-9][A-Za-z0-9._-]*\.wav$/
const clipFolder = 'clips/'
const clipName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Where kept audio goes in the zip: a take's in `audio/`, a clip's in
// `clips/`, each by its file's own name.
const zipPathOf = (file: string): string =>
  `${file.startsWith(clipFolder) ? clipFolder : audioFolder}${file.slice(file.lastIndexOf('/') + 1)}`

const earliestZipDate = Date.UTC(1980, 0, 1, 12)
const latestZipDate = Date.UTC(2099, 11, 31, 12)

// The backup file of `dump`, made at `exportedAt`.
export const encodeBackup = (
  dump: HistoryDump,
  exportedAt: number,
): Uint8Array => {
  const file: BackupFile = {
    app: 'intone',
    kind: 'history backup',
    format: historyFormat,
    exportedAt,
    settings: dump.settings,
    natives: dump.natives,
    takes: dump.takes,
    clips: dump.clips,
  }
  const audio = Object.fromEntries(
    [...dump.audio].map(([path, bytes]) => [zipPathOf(path), bytes] as const),
  )
  // NOTE: the audio is stored, not deflated: WAV hardly shrinks, and
  // storing keeps a large backup quick to make.
  // Each file is dated by the backup, so the same history saved at the
  // same moment is the same file, byte for byte; within the years a zip
  // can date, whatever the device's clock says.
  const mtime = new Date(
    Math.min(Math.max(exportedAt, earliestZipDate), latestZipDate),
  )
  return zipSync({
    [historyFile]: [strToU8(encodeJson(file)), { mtime }],
    ...Object.fromEntries(
      Object.entries(audio).map(
        ([path, bytes]) => [path, [bytes, { level: 0, mtime }]] as const,
      ),
    ),
  })
}

const refused = (reason: string) =>
  new BackupError({
    reason: `This file is not an Intone backup this app can read: ${reason}`,
  })

const unzipped = (
  bytes: Uint8Array,
): Effect.Effect<Record<string, Uint8Array>, BackupError> =>
  Effect.try({
    try: () =>
      unzipSync(bytes, {
        filter: file =>
          file.name === historyFile ||
          (file.name.startsWith(audioFolder) &&
            audioName.test(file.name.slice(audioFolder.length))) ||
          (file.name.startsWith(clipFolder) &&
            clipName.test(file.name.slice(clipFolder.length))),
      }),
    catch: () => refused('it is not a zip file.'),
  })

const isWav = (bytes: Uint8Array): boolean => {
  try {
    decodeWav(bytes)
    return true
  } catch {
    return false
  }
}

// The history in the backup file `bytes`, checked whole: its JSON by the
// history's Schemas, every take's native present, and the audio of every
// take that names it there and readable as WAV.
export const decodeBackup = (
  bytes: Uint8Array,
): Effect.Effect<HistoryDump, BackupError> =>
  Effect.gen(function* () {
    const files = yield* unzipped(bytes)
    const json = files[historyFile]
    if (json === undefined) {
      return yield* refused(`it has no ${historyFile}.`)
    }
    const text = yield* Effect.try({
      try: () => strFromU8(json),
      catch: () => refused(`its ${historyFile} is not text.`),
    })
    const decoded = decodeJson(text)
    if (decoded._tag === 'Failure') {
      return yield* refused(`its ${historyFile} does not hold a history.`)
    }
    const backup = decoded.value
    const nativeIds = new Set(backup.natives.map(native => native.id))
    const orphan = backup.takes.find(
      ({ entry }) => !nativeIds.has(entry.nativeId),
    )
    if (orphan !== undefined) {
      return yield* refused(
        `a take of ${orphan.entry.lineText} is missing the line it was scored against.`,
      )
    }
    const audio = backup.takes.flatMap(({ entry }) =>
      Option.match(Option.fromNullishOr(entry.audio), {
        onNone: () => [],
        onSome: ({ file }) => [{ file, zipped: files[zipPathOf(file)] }],
      }),
    )
    const missing = audio.find(
      ({ zipped }) => zipped === undefined || !isWav(zipped),
    )
    if (missing !== undefined) {
      return yield* refused(
        `the recording ${missing.file} is missing or damaged.`,
      )
    }
    const clips = backup.clips ?? []
    const clipNatives = clips.find(clip =>
      clipNativeIds(clip).some(nativeId => !nativeIds.has(nativeId)),
    )
    if (clipNatives !== undefined) {
      return yield* refused(
        `the clip ${clipNatives.name} is missing a line's curve.`,
      )
    }
    const clipAudio = clips.flatMap(clip =>
      clipAudioFiles(clip).map(audio => ({
        file: audio.file,
        bytes: audio.bytes,
        zipped: files[zipPathOf(audio.file)],
      })),
    )
    const missingClip = clipAudio.find(
      ({ zipped, bytes }) => zipped === undefined || zipped.length !== bytes,
    )
    if (missingClip !== undefined) {
      return yield* refused(
        `the clip ${missingClip.file} is missing or damaged.`,
      )
    }
    return {
      settings: backup.settings,
      natives: backup.natives,
      takes: backup.takes,
      clips,
      audio: new Map(
        [...audio, ...clipAudio].flatMap(({ file, zipped }) =>
          zipped === undefined ? [] : [[file, zipped] as const],
        ),
      ),
    }
  })

// The name the backup is saved under, by the learner's day.
export const backupFileName = (day: string): string =>
  `intone-history-${day}.zip`
