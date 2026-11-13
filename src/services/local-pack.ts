import { Clock, Effect, Option, Queue, Schema, Stream } from 'effect'

import { ClipAnalyser, type OpenFile } from './clip-analyser'
import { nextLineIdOf } from './clip-edits'
import type { ClipFileWrite } from './history-clips'
import {
  type ClipAudio,
  type ClipEntry,
  type ClipLine,
  type LineSource,
  type NativeEntry,
  type PackFile,
  historyFormat,
  recordingId,
  storedRecordingOf,
} from './history-records'
import { HistoryStore } from './history-store'

// Daniel's local pack (docs/local-pack.md): a manifest, pack.json, and
// the audio files it names, chosen together or as their folder, imported
// as one level and kept on the device like an upload. Nothing here
// fetches anything: a line's source link is only kept, to be shown. The
// manifest is checked whole and every file it names found before any
// file is read; then each file's SHA-256 tells an unchanged file from a
// changed one, so importing the manifest again keeps each line whose file
// and span are unchanged, with its id, its curve and so its takes, and
// tracks only the lines that are new. The upload screen's Subscription
// runs it (../app/upload/subscriptions.ts).

export const packManifestName = 'pack.json'

// A take records at most 30 s, so a line is shorter than that with room
// to spare; a line shorter than the line editor's shortest has too few
// frames to compare.
export const longestPackLineSeconds = 20
export const shortestPackLineSeconds = 0.25

// How far past the end of its file a line may say it ends, for a time
// rounded up in the manifest.
const endTolerance = 0.05

const Seconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

const PackPath = Schema.String.check(
  Schema.isPattern(/^(?![/\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\\0]+$/, {
    message:
      'a path from the folder pack.json is in, such as audio/line-1.wav, with no .. in it',
  }),
)

const WebAddress = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[^\s/?#]+[^\s]*$/, {
    message: 'a web address starting https:// or http://',
  }),
)

export const PackManifestLine = Schema.Struct({
  file: PackPath,
  // Seconds from the file's start; the start is 0 and the end the file's
  // end when not given.
  start: Schema.optionalKey(Seconds),
  end: Schema.optionalKey(Seconds),
  text: Schema.optionalKey(Schema.String),
  kana: Schema.optionalKey(Schema.String),
  // Where the line came from, such as a YouTube video, and the times in
  // it: shown as a link, never fetched.
  source: Schema.optionalKey(
    Schema.Struct({
      url: WebAddress,
      start: Schema.optionalKey(Seconds),
      end: Schema.optionalKey(Seconds),
    }),
  ),
})
export type PackManifestLine = typeof PackManifestLine.Type

export const PackManifest = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String.check(
    Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/, {
      message:
        'up to 63 lower-case letters, digits and dashes, such as jsut-basic',
    }),
  ),
  name: Schema.String.check(
    Schema.isPattern(/\S/, { message: 'a name for the level' }),
  ),
  lines: Schema.Array(PackManifestLine).check(
    Schema.isMinLength(1, { message: 'at least one line' }),
  ),
})
export type PackManifest = typeof PackManifest.Type

export class PackImportError extends Schema.TaggedError<
  PackImportError,
  { readonly brand: unique symbol }
>()('PackImportError', { reason: Schema.String }) {}

const refused = (reason: string) => new PackImportError({ reason })

// A file the learner chose: its path in the folder they chose (its name
// alone when they chose files), and the file.
export type ChosenFile = Readonly<{ path: string; file: Blob }>

// What an import says as it goes.
export type PackEvent =
  | Readonly<{ _tag: 'Reading' }>
  // `done` of `total` files read and checked.
  | Readonly<{ _tag: 'CheckingFiles'; done: number; total: number }>
  // `done` of `total` new lines' pitch found.
  | Readonly<{ _tag: 'TrackingLines'; done: number; total: number }>
  | Readonly<{ _tag: 'Keeping' }>
  | Readonly<{
      _tag: 'Imported'
      clipId: string
      // Lines kept as they were, with their takes; lines new or changed;
      // lines the manifest no longer has.
      kept: number
      added: number
      removed: number
    }>

// The level a pack is kept as: by the manifest's id, so a later import
// of it finds it.
export const packClipId = (id: string): string => `pack-${id}`

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const folderOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''

const depthOf = (path: string): number => path.split('/').length

// The manifest among the chosen files: the pack.json nearest the top of
// the folder chosen.
export const findManifest = (
  chosen: ReadonlyArray<ChosenFile>,
): ChosenFile | PackImportError => {
  const manifests = chosen.filter(
    ({ path }) => nameOf(path) === packManifestName,
  )
  const top = Math.min(...manifests.map(({ path }) => depthOf(path)))
  const nearest = manifests.filter(({ path }) => depthOf(path) === top)
  const [manifest, ...others] = nearest
  if (manifest === undefined) {
    return refused(
      `There is no ${packManifestName} in what you chose. Choose the pack’s ${packManifestName} with its audio files, or the folder that holds them.`,
    )
  }
  if (others.length > 0) {
    return refused(
      `What you chose holds ${nearest.length} files named ${packManifestName}. Choose one pack at a time.`,
    )
  }
  return manifest
}

const listed = (paths: ReadonlyArray<string>): string =>
  paths.length <= 5
    ? paths.join(', ')
    : `${paths.slice(0, 5).join(', ')} and ${paths.length - 5} more`

// Each file the manifest names, found among the chosen files: by its path
// from the manifest's folder, or, for files chosen one by one, which have
// no path, by its name alone.
export const resolveFiles = (
  manifest: PackManifest,
  manifestPath: string,
  chosen: ReadonlyArray<ChosenFile>,
): ReadonlyMap<string, ChosenFile> | PackImportError => {
  const folder = folderOf(manifestPath)
  const paths = [...new Set(manifest.lines.map(line => line.file))]
  const found = new Map<string, ChosenFile>()
  const missing: Array<string> = []
  const ambiguous: Array<string> = []
  paths.forEach(path => {
    const exact = chosen.find(file => file.path === `${folder}${path}`)
    const byName = chosen.filter(
      file => !file.path.includes('/') && file.path === nameOf(path),
    )
    if (exact !== undefined) {
      found.set(path, exact)
    } else if (byName.length === 1 && byName[0] !== undefined) {
      found.set(path, byName[0])
    } else if (byName.length > 1) {
      ambiguous.push(path)
    } else {
      missing.push(path)
    }
  })
  const namesShared = paths.filter(
    path =>
      found.get(path) !== undefined &&
      !found.get(path)?.path.includes('/') &&
      paths.some(other => other !== path && nameOf(other) === nameOf(path)),
  )
  if (missing.length > 0) {
    return refused(
      `${packManifestName} names ${missing.length === 1 ? 'a file' : `${missing.length} files`} you did not choose: ${listed(missing)}. Choose ${missing.length === 1 ? 'it' : 'them'} too, or the folder that holds the pack.`,
    )
  }
  if (ambiguous.length > 0 || namesShared.length > 0) {
    return refused(
      `${packManifestName} names files in different folders with the same name (${listed([...ambiguous, ...namesShared])}). Choose the folder that holds the pack, so each is found by its path.`,
    )
  }
  return found
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// The manifest's text, read as JSON and checked by its Schema, and each
// line's times.
export const readManifest = (text: string): PackManifest | PackImportError => {
  const parsed = Schema.decodeExit(Schema.fromJsonString(Schema.Unknown))(text)
  if (parsed._tag === 'Failure') {
    return refused(
      `${packManifestName} is not JSON. See docs/local-pack.md for its format.`,
    )
  }
  const decoded = Schema.decodeUnknownExit(PackManifest)(parsed.value)
  if (decoded._tag === 'Failure') {
    const issue = String(decoded.cause)
      .replace(/^[^(]*\(/, '')
      .replace(/\)\s*$/, '')
      .replace(/\s*\n\s*/g, ' ')
    return refused(
      `${packManifestName} is not a pack this app can read: ${issue}. See docs/local-pack.md for its format.`,
    )
  }
  const manifest = decoded.value
  const wrong = manifest.lines.flatMap((line, k) =>
    line.start !== undefined &&
    line.end !== undefined &&
    !(line.end - line.start >= shortestPackLineSeconds)
      ? [`line ${k + 1} ends before it starts, or within 0.25 s of it`]
      : line.start !== undefined &&
          line.end !== undefined &&
          line.end - line.start > longestPackLineSeconds
        ? [`line ${k + 1} is over ${longestPackLineSeconds} s long`]
        : [],
  )
  if (wrong.length > 0) {
    return refused(
      `In ${packManifestName}, ${listed(wrong)}. A line is a quarter of a second to ${longestPackLineSeconds} s long.`,
    )
  }
  return manifest
}

const hexOf = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

const sha256Of = (file: Blob): Effect.Effect<string, PackImportError> =>
  Effect.tryPromise({
    try: async () =>
      hexOf(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    catch: error => refused(`A file could not be read: ${messageOf(error)}`),
  })

// Where a pack's file is kept: by the pack and the file's content, with
// the file's own extension when it has a plain one.
export const packAudioPathOf = (
  id: string,
  path: string,
  sha256: string,
): string => {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(path)?.[1]?.toLowerCase()
  return `clips/${packClipId(id)}-${sha256.slice(0, 16)}.${extension ?? 'audio'}`
}

const sameTime = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6

// The line's text, kana and source as the manifest gives them now.
const extrasOf = (
  line: PackManifestLine,
): Pick<ClipLine, 'text' | 'kana' | 'source'> => ({
  ...(line.text === undefined || line.text.trim() === ''
    ? {}
    : { text: line.text.trim() }),
  ...(line.kana === undefined || line.kana.trim() === ''
    ? {}
    : { kana: line.kana.trim() }),
  ...(line.source === undefined
    ? {}
    : {
        source: {
          url: line.source.url,
          ...(line.source.start === undefined
            ? {}
            : { from: line.source.start }),
          ...(line.source.end === undefined ? {} : { to: line.source.end }),
        } satisfies LineSource,
      }),
})

// The line without what the manifest gives it, to be given it again.
const withoutExtras = ({
  text: _text,
  kana: _kana,
  source: _source,
  ...line
}: ClipLine): ClipLine => line

// A file of the pack, read: its path, the chosen file and its SHA-256.
type CheckedFile = Readonly<{ path: string; file: Blob; sha256: string }>

type Planned =
  | Readonly<{ _tag: 'Kept'; line: ClipLine }>
  | Readonly<{
      _tag: 'Track'
      id: string
      path: string
      from: number
      // None: to the file's end.
      maybeTo: Option.Option<number>
      extras: Pick<ClipLine, 'text' | 'kana' | 'source'>
    }>

export type PackPlan = Readonly<{
  lines: ReadonlyArray<Planned>
  nextLineId: number
  // The files whose lines must be tracked, by path.
  toTrack: ReadonlyArray<string>
}>

// Which lines of `manifest` are kept from the pack as it was (`before`):
// the same file, by its SHA-256, and the same span; each of the others is
// a new line with a new id, and is tracked.
export const planPack = (
  manifest: PackManifest,
  files: ReadonlyMap<string, Pick<CheckedFile, 'sha256'>>,
  before: Option.Option<ClipEntry>,
): PackPlan => {
  const was = Option.getOrUndefined(before)
  const unchangedFile = (path: string): PackFile | undefined =>
    was?.pack?.files.find(
      file => file.path === path && file.sha256 === files.get(path)?.sha256,
    )
  const taken = new Set<string>()
  const ids = { next: was === undefined ? 1 : nextLineIdOf(was) }
  const lines = manifest.lines.map((line): Planned => {
    const from = line.start ?? 0
    const unchanged = unchangedFile(line.file)
    const to =
      line.end ?? (unchanged === undefined ? undefined : unchanged.seconds)
    const match =
      unchanged === undefined || to === undefined
        ? undefined
        : was?.lines.find(
            old =>
              !taken.has(old.id) &&
              old.file === line.file &&
              sameTime(old.from, from) &&
              sameTime(old.to, to),
          )
    if (match !== undefined) {
      taken.add(match.id)
      return {
        _tag: 'Kept',
        line: { ...withoutExtras(match), ...extrasOf(line) },
      }
    }
    const id = String(ids.next)
    ids.next += 1
    return {
      _tag: 'Track',
      id,
      path: line.file,
      from,
      maybeTo: Option.fromNullishOr(line.end),
      extras: extrasOf(line),
    }
  })
  const toTrack = [
    ...new Set(
      lines.flatMap(line => (line._tag === 'Track' ? [line.path] : [])),
    ),
  ]
  return { lines, nextLineId: ids.next, toTrack }
}

const typeOf = (file: Blob): string => file.type

// The tracked lines of each file in `plan.toTrack`, by id, and each
// file's length, with one clip Worker for them all.
const trackFiles = (
  plan: PackPlan,
  files: ReadonlyMap<string, CheckedFile>,
  open: OpenFile,
  progress: (done: number, total: number) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const total = plan.lines.filter(line => line._tag === 'Track').length
    const tracked = new Map<string, ClipLine>()
    const natives: Array<NativeEntry> = []
    const seconds = new Map<string, number>()
    yield* progress(0, total)
    for (const path of plan.toTrack) {
      const checked = files.get(path)
      if (checked === undefined) {
        return yield* refused(`${path} was not chosen.`)
      }
      const opened = yield* open(checked.file).pipe(
        Effect.mapError(error => refused(`${path}: ${error.reason}`)),
      )
      seconds.set(path, opened.seconds)
      const ofFile = plan.lines.flatMap(line =>
        line._tag === 'Track' && line.path === path ? [line] : [],
      )
      const spans = ofFile.map(line => ({
        id: line.id,
        from: line.from,
        to: Option.getOrElse(line.maybeTo, () => opened.seconds),
      }))
      const late = spans.find(
        span => span.to > opened.seconds + endTolerance || span.from >= span.to,
      )
      if (late !== undefined) {
        return yield* refused(
          `A line of ${path} runs from ${late.from} s to ${late.to.toFixed(2)} s, and the file is ${opened.seconds.toFixed(2)} s long.`,
        )
      }
      const long = spans.find(
        span =>
          span.to - span.from > longestPackLineSeconds ||
          span.to - span.from < shortestPackLineSeconds,
      )
      if (long !== undefined) {
        return yield* refused(
          `A line of ${path} is ${(long.to - long.from).toFixed(2)} s long. A line is a quarter of a second to ${longestPackLineSeconds} s long: give it a start and an end.`,
        )
      }
      const lines = yield* opened
        .track(
          spans.map(span => ({
            from: span.from,
            to: Math.min(span.to, opened.seconds),
          })),
        )
        .pipe(Effect.mapError(error => refused(`${path}: ${error.reason}`)))
      if (lines.length !== spans.length) {
        return yield* refused(
          `${spans.length} lines of ${path} were to be tracked, and ${lines.length} were.`,
        )
      }
      spans.forEach((span, k) => {
        const made = lines[k]
        const planned = ofFile[k]
        if (made === undefined || planned === undefined) {
          return
        }
        const native = made.native
        const base = { id: span.id, from: span.from, to: span.to, file: path }
        if (native._tag === 'Tracked') {
          const nativeId = recordingId(native.recording)
          natives.push({
            format: historyFormat,
            id: nativeId,
            recording: storedRecordingOf(native.recording),
          })
          tracked.set(span.id, {
            ...base,
            native: { _tag: 'Tracked', nativeId },
            quality: native.quality,
            ...planned.extras,
          })
        } else {
          tracked.set(span.id, {
            ...base,
            native: { _tag: native._tag },
            ...planned.extras,
          })
        }
      })
      yield* progress(tracked.size, total)
    }
    return { tracked, natives, seconds }
  })

// Imports the pack among `chosen`, step by step, as one level of the
// history; interrupting the Stream before it is keeping stops it, and
// keeps nothing.
export const importPack = (
  chosen: ReadonlyArray<ChosenFile>,
): Stream.Stream<PackEvent, PackImportError, ClipAnalyser | HistoryStore> =>
  Stream.callback<PackEvent, PackImportError, ClipAnalyser | HistoryStore>(
    queue => {
      const say = (event: PackEvent) =>
        Queue.offer(queue, event).pipe(Effect.asVoid)
      return Effect.gen(function* () {
        const history = yield* HistoryStore
        const analyser = yield* ClipAnalyser
        yield* say({ _tag: 'Reading' })
        const manifestFile = findManifest(chosen)
        if (manifestFile instanceof PackImportError) {
          return yield* manifestFile
        }
        const text = yield* Effect.tryPromise({
          try: () => manifestFile.file.text(),
          catch: error =>
            refused(
              `${packManifestName} could not be read: ${messageOf(error)}`,
            ),
        })
        const manifest = readManifest(text)
        if (manifest instanceof PackImportError) {
          return yield* manifest
        }
        const resolved = resolveFiles(manifest, manifestFile.path, chosen)
        if (resolved instanceof PackImportError) {
          return yield* resolved
        }
        const paths = [...resolved.keys()]
        const checked = new Map<string, CheckedFile>()
        yield* say({ _tag: 'CheckingFiles', done: 0, total: paths.length })
        for (const path of paths) {
          const found = resolved.get(path)
          if (found !== undefined) {
            checked.set(path, {
              path,
              file: found.file,
              sha256: yield* sha256Of(found.file),
            })
            yield* say({
              _tag: 'CheckingFiles',
              done: checked.size,
              total: paths.length,
            })
          }
        }
        const clipId = packClipId(manifest.id)
        const before = yield* history
          .clip(clipId)
          .pipe(Effect.mapError(error => refused(error.reason)))
        const plan = planPack(manifest, checked, before)
        const { tracked, natives, seconds } = yield* Effect.scoped(
          plan.toTrack.length === 0
            ? Effect.succeed({
                tracked: new Map<string, ClipLine>(),
                natives: [],
                seconds: new Map<string, number>(),
              })
            : analyser.tracker.pipe(
                Effect.mapError(error => refused(error.reason)),
                Effect.flatMap(open =>
                  trackFiles(plan, checked, open, (done, total) =>
                    say({ _tag: 'TrackingLines', done, total }),
                  ),
                ),
              ),
        )
        yield* say({ _tag: 'Keeping' })
        const was = Option.getOrUndefined(before)
        const writes: Array<ClipFileWrite> = []
        const packFiles = paths.flatMap((path): ReadonlyArray<PackFile> => {
          const file = checked.get(path)
          if (file === undefined) {
            return []
          }
          const old = was?.pack?.files.find(
            found => found.path === path && found.sha256 === file.sha256,
          )
          const length = seconds.get(path) ?? old?.seconds ?? 0
          if (old?.audio !== null && old?.audio !== undefined) {
            return [{ ...old, seconds: length }]
          }
          const audio: ClipAudio = {
            file: packAudioPathOf(manifest.id, path, file.sha256),
            type: typeOf(file.file),
            bytes: file.file.size,
          }
          writes.push({ file: audio.file, blob: file.file })
          return [{ path, sha256: file.sha256, seconds: length, audio }]
        })
        const lines = plan.lines.flatMap(line =>
          line._tag === 'Kept'
            ? [line.line]
            : Option.toArray(Option.fromNullishOr(tracked.get(line.id))),
        )
        const addedAt = yield* Clock.currentTimeMillis
        const next: ClipEntry = {
          format: historyFormat,
          id: clipId,
          name: manifest.name.trim(),
          addedAt: was?.addedAt ?? addedAt,
          seconds: packFiles.reduce((sum, file) => sum + file.seconds, 0),
          audio: null,
          lines,
          nextLineId: plan.nextLineId,
          pack: { id: manifest.id, files: packFiles },
        }
        yield* history.replaceClip(before, next, natives, writes).pipe(
          Effect.mapError(error => refused(error.reason)),
          Effect.uninterruptible,
        )
        const kept = plan.lines.filter(line => line._tag === 'Kept').length
        yield* say({
          _tag: 'Imported',
          clipId,
          kept,
          added: lines.length - kept,
          removed: (was?.lines.length ?? 0) - kept,
        })
      }).pipe(
        Effect.andThen(Queue.end(queue)),
        Effect.catch(error => Queue.fail(queue, error)),
      )
    },
  )
