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

// A clip the learner brought (ticket 13): its file in the clip store, by
// its own media type, and its lines, each a stretch of it with the native
// curve tracked from it, kept in the natives store as a take's native is.
// A line whose audio gave no curve says why, and cannot be copied.
export const ClipAudio = Schema.Struct({
  file: Schema.String.check(
    Schema.isPattern(/^clips\/[A-Za-z0-9][A-Za-z0-9._-]*$/),
  ),
  // The file's media type, as the browser named it, so it plays as it
  // came; empty when the browser did not know.
  type: Schema.String,
  bytes: Schema.Finite,
})
export type ClipAudio = typeof ClipAudio.Type

export const LineNative = Schema.Union([
  Schema.TaggedStruct('Tracked', { nativeId: Schema.String }),
  Schema.TaggedStruct('TooQuiet', {}),
  Schema.TaggedStruct('TooNoisy', {}),
])
export type LineNative = typeof LineNative.Type

// How far a line's native curve can be trusted
// (../engine/cut/quality.ts): the share of its speech with a confident
// pitch, and the share of its pauses that still have one.
export const LineQuality = Schema.Struct({
  speechFrames: Schema.Finite,
  confidentShare: Fraction,
  pauseFrames: Schema.Finite,
  pausePitchedShare: Fraction,
})
export type LineQuality = typeof LineQuality.Type

// Where a line of the local pack came from (docs/local-pack.md): a link
// and the times in it, which the app shows as a link opened in a new tab
// and never fetches.
export const LineSource = Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s/?#]+[^\s]*$/)),
  from: Schema.optionalKey(Schema.Finite),
  to: Schema.optionalKey(Schema.Finite),
})
export type LineSource = typeof LineSource.Type

export const ClipLine = Schema.Struct({
  // Unique in its clip, and never used again once the line is gone, since
  // its takes keep it: the line's number when the clip was cut, or the
  // clip's next id when a split made it.
  id: Schema.String,
  // Seconds from the start of its audio: the clip's, or its pack file's.
  from: Schema.Finite,
  to: Schema.Finite,
  native: LineNative,
  // A tracked line's quality; none on a line cut before it was measured.
  quality: Schema.optionalKey(LineQuality),
  // A line of a local pack: the path of its file in the pack, and the
  // text, kana and source its manifest gives, each only when given.
  file: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  kana: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(LineSource),
})
export type ClipLine = typeof ClipLine.Type

// The learner's last change to a clip's lines, and the line it changed by
// its place in the clip then, counting from 1: what undoing it says.
export const LineChange = Schema.Struct({
  kind: Schema.Literals(['Moved', 'Split', 'Merged', 'Deleted']),
  lineNumber: Schema.Finite,
})
export type LineChange = typeof LineChange.Type

// The lines as they were before the last change, so it can be undone
// once; their curves are kept until it can no longer be.
export const ClipUndo = Schema.Struct({
  change: LineChange,
  lines: Schema.Array(ClipLine),
})
export type ClipUndo = typeof ClipUndo.Type

// A file of a local pack (ticket 15): its path in the pack, its SHA-256,
// which tells a changed file from the same one imported again, its length
// and where it is kept, by its content (null when it came from a backup
// that left its audio out).
export const PackFile = Schema.Struct({
  path: Schema.String,
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  seconds: Schema.Finite,
  audio: Schema.NullOr(ClipAudio),
})
export type PackFile = typeof PackFile.Type

export const ClipPack = Schema.Struct({
  // The manifest's own id, which a later import of it is matched by.
  id: Schema.String,
  files: Schema.Array(PackFile),
})
export type ClipPack = typeof ClipPack.Type

export const ClipEntry = Schema.Struct({
  format: Format,
  id: Schema.String,
  // The file's own name.
  name: Schema.String,
  // Milliseconds since 1970.
  addedAt: Schema.Finite,
  seconds: Schema.Finite,
  // Null when the clip came from a backup that left its audio out.
  audio: Schema.NullOr(ClipAudio),
  lines: Schema.Array(ClipLine),
  // The id the next line a split makes gets; none until a split, when it
  // is one past the lines the clip was cut into.
  nextLineId: Schema.optionalKey(Schema.Finite),
  // The last change to the lines, until it is undone.
  undo: Schema.optionalKey(ClipUndo),
  // A level imported from the local pack: its files, each line naming
  // one. Its `audio` is null, and its lines change only by importing its
  // manifest again.
  pack: Schema.optionalKey(ClipPack),
})
export type ClipEntry = typeof ClipEntry.Type

// Every audio file a clip keeps: an upload's one, or its pack's.
export const clipAudioFiles = (clip: ClipEntry): ReadonlyArray<ClipAudio> =>
  [clip.audio, ...(clip.pack?.files ?? []).map(file => file.audio)].filter(
    (audio): audio is ClipAudio => audio !== null,
  )

// The audio a line plays from: its pack file's, or its clip's.
export const lineAudioOf = (
  clip: ClipEntry,
  line: Pick<ClipLine, 'file'>,
): ClipAudio | null =>
  line.file === undefined
    ? clip.audio
    : (clip.pack?.files.find(file => file.path === line.file)?.audio ?? null)

// Whether every line's audio is on this device.
export const clipHasAudio = (clip: ClipEntry): boolean =>
  clip.pack === undefined
    ? clip.audio !== null
    : clip.pack.files.every(file => file.audio !== null)

// The clip with no reference to its audio, as a backup without the
// recordings carries it.
export const clipWithoutAudio = (clip: ClipEntry): ClipEntry =>
  clip.pack === undefined
    ? { ...clip, audio: null }
    : {
        ...clip,
        audio: null,
        pack: {
          id: clip.pack.id,
          files: clip.pack.files.map(file => ({ ...file, audio: null })),
        },
      }

// The clip, each file it has no audio for taking the audio `here` keeps
// of the same file (by its SHA-256 for a pack's), as a restore does.
export const clipKeepingAudioOf = (
  clip: ClipEntry,
  here: ClipEntry | undefined,
): ClipEntry =>
  clip.pack === undefined
    ? { ...clip, audio: clip.audio ?? here?.audio ?? null }
    : {
        ...clip,
        pack: {
          id: clip.pack.id,
          files: clip.pack.files.map(file => ({
            ...file,
            audio:
              file.audio ??
              here?.pack?.files.find(
                found =>
                  found.path === file.path && found.sha256 === file.sha256,
              )?.audio ??
              null,
          })),
        },
      }

// The native curves a clip's records name: its lines', and those of its
// lines before the last change, kept so it can be undone.
export const clipNativeIds = (clip: ClipEntry): ReadonlyArray<string> =>
  [...clip.lines, ...(clip.undo?.lines ?? [])].flatMap(line =>
    line.native._tag === 'Tracked' ? [line.native.nativeId] : [],
  )

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

// Everything kept, for the backup (./backup.ts): the kept audio of the
// takes and the clips by its file's path, when asked for.
export type HistoryDump = Readonly<{
  settings: Settings
  natives: ReadonlyArray<NativeEntry>
  takes: ReadonlyArray<DumpedTake>
  clips: ReadonlyArray<ClipEntry>
  audio: ReadonlyMap<string, Uint8Array>
}>
