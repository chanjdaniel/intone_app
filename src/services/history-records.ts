import { Schema } from 'effect'

import type { Recording, Score } from '../score/score'

// The history's records, as IndexedDB holds them and as the backup file
// carries them, each checked by its Schema on every read
// (./history-store.ts, ./backup.ts). A take is split in two: its entry
// (the line, the date, the score), which the history screens read for
// every take, and its recording (the curve and features the tracker
// made, and its pitch at each native frame), read only to draw it or to
// score it again. The native recording a take was scored against is
// kept once, by its content, however many takes share it.

// The history's format, written in the database's meta store
// (./indexed-db.ts) and in each record. A later format bumps the
// database's version, converts the records it changes in its upgrade,
// and moves this number on.
export const historyFormat = 1

const Format = Schema.Literal(historyFormat)

// Frames as IndexedDB keeps them: the typed array itself.
export const Frames = Schema.instanceOf(Float32Array<ArrayBufferLike>)
export type FramesSchema = Schema.Codec<Float32Array<ArrayBufferLike>, unknown>

// A curve and its features, as the tracker gave them, with its frames
// as `frames` encodes them: typed arrays here, text in the backup
// (./backup.ts), so both are checked by one Schema.
export const recordingOf = <F extends FramesSchema>(frames: F) =>
  Schema.Struct({
    frameHz: Schema.Finite,
    f0Hz: frames,
    confidence: frames,
    levelDb: frames,
    onsetFrame: Schema.Finite,
    featureDims: Schema.Finite,
    features: frames,
  })

export const StoredRecording = recordingOf(Frames)
export type StoredRecording = typeof StoredRecording.Type

export const storedRecordingOf = ({
  curve,
  features,
}: Recording): StoredRecording => ({
  frameHz: curve.frameHz,
  f0Hz: curve.f0Hz,
  confidence: curve.confidence,
  levelDb: curve.levelDb,
  onsetFrame: curve.onsetFrame,
  featureDims: features.dims,
  features: features.data,
})

export const recordingOfStored = (stored: StoredRecording): Recording => ({
  curve: {
    frameHz: stored.frameHz,
    f0Hz: stored.f0Hz,
    confidence: stored.confidence,
    levelDb: stored.levelDb,
    onsetFrame: stored.onsetFrame,
  },
  features: {
    frameHz: stored.frameHz,
    dims: stored.featureDims,
    data: stored.features,
  },
})

// The score as src/score/score.ts gives it, with the version that made
// it, so a take scored by an earlier version can be told apart and
// scored again.
const Fraction = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1),
)

export const StoredScore = Schema.Union([
  Schema.TaggedStruct('Scored', {
    version: Schema.Finite,
    match: Fraction,
    parts: Schema.Struct({
      pitchAccent: Fraction,
      timing: Fraction,
      sounds: Schema.optionalKey(Fraction),
    }),
    worstStretch: Schema.Struct({
      nativeFrom: Schema.Finite,
      nativeTo: Schema.Finite,
      takeFrom: Schema.Finite,
      takeTo: Schema.Finite,
    }),
    provisional: Schema.Boolean,
  }),
  Schema.TaggedStruct('CouldNotCompare', {
    version: Schema.Finite,
    reason: Schema.Literals(['TooLittleVoiced', 'LengthMismatch', 'TooQuiet']),
  }),
])
export type StoredScore = typeof StoredScore.Type

// The two are the same shape; this proves it each way.
export const storedScoreOf = (score: Score): StoredScore => score
export const scoreOfStored = (stored: StoredScore): Score => stored

// A guided take shows the native's curve and the learner's as they
// speak; a blind one shows nothing until it ends (ticket 18).
export const TakeMode = Schema.Literals(['Guided', 'Blind'])
export type TakeMode = typeof TakeMode.Type

// The learner's own day, as `YYYY-MM-DD`, when the take was made.
export const Day = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

// Where a take's kept audio is in the clip store (./clip-store.ts).
export const KeptAudio = Schema.Struct({
  file: Schema.String.check(
    Schema.isPattern(/^takes\/[A-Za-z0-9][A-Za-z0-9._-]*\.wav$/),
  ),
  sampleRate: Schema.Finite,
  seconds: Schema.Finite,
})
export type KeptAudio = typeof KeptAudio.Type

export const TakeEntry = Schema.Struct({
  format: Format,
  id: Schema.String,
  clipId: Schema.String,
  lineId: Schema.String,
  // The line as written when the take was made, so the history can name
  // it after its clip is gone.
  lineText: Schema.String,
  mode: TakeMode,
  // Milliseconds since 1970, and the learner's day then.
  takenAt: Schema.Finite,
  day: Day,
  nativeId: Schema.String,
  score: StoredScore,
  audio: Schema.NullOr(KeptAudio),
})
export type TakeEntry = typeof TakeEntry.Type

export const takeRecordingOf = <F extends FramesSchema>(frames: F) =>
  Schema.Struct({
    format: Format,
    id: Schema.String,
    take: recordingOf(frames),
    // Hz at each native frame, through the score's alignment; null when
    // it could not compare.
    alignedF0: Schema.NullOr(frames),
  })
export const TakeRecording = takeRecordingOf(Frames)
export type TakeRecording = typeof TakeRecording.Type

export const nativeEntryOf = <F extends FramesSchema>(frames: F) =>
  Schema.Struct({
    format: Format,
    id: Schema.String,
    recording: recordingOf(frames),
  })
export const NativeEntry = nativeEntryOf(Frames)
export type NativeEntry = typeof NativeEntry.Type

export const Settings = Schema.Struct({
  // Whether each take's audio is kept with it; off until the learner
  // turns it on.
  keepTakeAudio: Schema.Boolean,
})
export type Settings = typeof Settings.Type

export const defaultSettings: Settings = { keepTakeAudio: false }

// FNV-1a over 32-bit words, from `seed`.
const fnv = (words: ReadonlyArray<Uint32Array>, seed: number): number =>
  words.reduce(
    (hash, array) =>
      array.reduce(
        (inner, word) => Math.imul(inner ^ word, 0x01000193) >>> 0,
        Math.imul(hash ^ array.length, 0x01000193) >>> 0,
      ),
    seed >>> 0,
  )

const wordsOf = (array: Float32Array): Uint32Array =>
  new Uint32Array(array.buffer, array.byteOffset, array.length)

// A recording's id, from its content: the same recording always has the
// same id, so a native shared by many takes is kept once.
export const recordingId = (recording: Recording): string => {
  const words = [
    Uint32Array.of(
      Math.round(recording.curve.frameHz * 1000),
      recording.curve.onsetFrame,
      recording.features.dims,
    ),
    wordsOf(recording.curve.f0Hz),
    wordsOf(recording.curve.confidence),
    wordsOf(recording.curve.levelDb),
    wordsOf(recording.features.data),
  ]
  const hex = (value: number) => value.toString(16).padStart(8, '0')
  return `${hex(fnv(words, 0x811c9dc5))}${hex(fnv(words, 0x2f0e1d3b))}`
}

export type DumpedTake = Readonly<{
  entry: TakeEntry
  recording: TakeRecording
}>

// Everything kept, for the backup (./backup.ts): the kept audio by its
// file's path, when asked for.
export type HistoryDump = Readonly<{
  settings: Settings
  natives: ReadonlyArray<NativeEntry>
  takes: ReadonlyArray<DumpedTake>
  audio: ReadonlyMap<string, Uint8Array>
}>
