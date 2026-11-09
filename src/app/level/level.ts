import { Array, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { ClipEntry } from '../../services/history-records'
import { clipLineTitle, clockText } from '../line/lines'

// The learner's clips as the Model knows them: the list on the home
// screen, and one clip's lines on its level, /level/:clipId. Each is read
// from the device when its screen opens; only these few facts of a clip
// enter the Model, never its audio or its curves.

export const LevelLine = Schema.Struct({
  id: Schema.String,
  // Seconds from the clip's start.
  from: Schema.Finite,
  to: Schema.Finite,
  // Whether the line has a native curve to copy, or why not.
  native: Schema.Literals(['Tracked', 'TooQuiet', 'TooNoisy']),
})
export type LevelLine = typeof LevelLine.Type

export const LevelClip = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  seconds: Schema.Finite,
  addedAt: Schema.Finite,
  // Whether its audio is on this device: a clip from a backup that left
  // its audio out has its lines but cannot be played.
  hasAudio: Schema.Boolean,
  lines: Schema.Array(LevelLine),
})
export type LevelClip = typeof LevelClip.Type

export const levelClipOf = (clip: ClipEntry): LevelClip => ({
  id: clip.id,
  name: clip.name,
  seconds: clip.seconds,
  addedAt: clip.addedAt,
  hasAudio: clip.audio !== null,
  lines: clip.lines.map(line => ({
    id: line.id,
    from: line.from,
    to: line.to,
    native: line.native._tag,
  })),
})

// A clip on the home screen.
export const ClipSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  seconds: Schema.Finite,
  lines: Schema.Finite,
  hasAudio: Schema.Boolean,
})
export type ClipSummary = typeof ClipSummary.Type

export const clipSummaryOf = (clip: ClipEntry): ClipSummary => ({
  id: clip.id,
  name: clip.name,
  seconds: clip.seconds,
  lines: clip.lines.length,
  hasAudio: clip.audio !== null,
})

export const ClipsPage = defineTaggedUnion({
  NotLoaded: {},
  Loading: {},
  // Newest first.
  Ready: { clips: Schema.Array(ClipSummary) },
  Failed: { reason: Schema.String },
})
export type ClipsPage = typeof ClipsPage.Type

export const DeleteState = defineTaggedUnion({
  Idle: {},
  Deleting: {},
  Failed: { reason: Schema.String },
})
export type DeleteState = typeof DeleteState.Type

export const LevelPage = defineTaggedUnion({
  NotLoaded: {},
  Loading: { clipId: Schema.String },
  Ready: {
    clip: LevelClip,
    // How many rows of the list are shown, a page at a time.
    shownRows: Schema.Finite,
    deleting: DeleteState,
  },
  // There is no such clip on this device.
  Missing: { clipId: Schema.String },
  Failed: { clipId: Schema.String, reason: Schema.String },
})
export type LevelPage = typeof LevelPage.Type

// The large-list frame's numbers (spec, "Frontend patterns applied"),
// as the history's list has them.
export const levelFindFromRows = 12
export const levelRowsPerPage = 50

export const deleteClipDialogId = 'delete-clip'

// A line's text in the list, which the find words are looked for in: its
// name and where it is in the clip.
export const levelLineText = (line: LevelLine): string =>
  `${clipLineTitle(line)} ${clockText(line.from, true)} ${clockText(line.to, true)}`

export const levelLinesFound = (
  lines: ReadonlyArray<LevelLine>,
  words: string,
): ReadonlyArray<LevelLine> => {
  const wanted = words.trim().toLocaleLowerCase()
  return wanted === ''
    ? lines
    : Array.filter(lines, line =>
        levelLineText(line).toLocaleLowerCase().includes(wanted),
      )
}
