import { Array, Option, Schema } from 'effect'
import type { KeyboardModifiers } from 'foldkit/html'
import { defineTaggedUnion } from 'foldkit/schema'

import {
  type Edge,
  type Span,
  canSplit,
  edgeLimits,
  movedEdge,
  onSampleGrid,
} from '../../engine/cut/edit'
import type { LevelClip, LevelLine } from './level'

// The line editor on an uploaded clip's level (ticket 14): the clip's
// waveform around the line selected, its two edges to drag or step, a
// playhead to play from and split at, and the line's merge, delete and
// the clip's one undo. Each change is kept on the device, the lines it
// moved tracked again first (../../services/clip-edits.ts), by the clip
// Worker the level holds while it is open (./resources.ts). An edge moved
// is a draft until it is let go, or until the keys have rested.

// The waveform, from the clip Worker once it holds the clip: a byte per
// 10 ms (../../engine/audio/peaks.ts).
export const ClipWaveform = defineTaggedUnion({
  Opening: {},
  Ready: { peaks: Schema.instanceOf(Uint8Array<ArrayBufferLike>) },
  Failed: { reason: Schema.String },
})
export type ClipWaveform = typeof ClipWaveform.Type

// Playing the selected line, `playNumber` the play's own, so a late word
// from an earlier play changes nothing.
export const LevelPlay = defineTaggedUnion({
  Stopped: {},
  Playing: {
    playNumber: Schema.Finite,
    from: Schema.Finite,
    to: Schema.Finite,
  },
})
export type LevelPlay = typeof LevelPlay.Type

export const EdgeName = Schema.Literals(['from', 'to'])

// An edge being moved: by the pointer until it is let go, or by the keys
// until they rest.
export const EdgeDraft = Schema.Struct({
  lineId: Schema.String,
  edge: EdgeName,
  seconds: Schema.Finite,
  draftNumber: Schema.Finite,
  by: Schema.Literals(['Pointer', 'Keyboard']),
})
export type EdgeDraft = typeof EdgeDraft.Type

export const EditSaving = defineTaggedUnion({
  Idle: {},
  // A change is being tracked and kept; once it is, the line `select`
  // names is selected, or the one at `index` when it is gone, and
  // `notice` says what was done.
  Saving: {
    maybeSelect: Schema.Option(Schema.String),
    index: Schema.Finite,
    notice: Schema.String,
  },
  Failed: { reason: Schema.String },
})
export type EditSaving = typeof EditSaving.Type

export const LineEditor = Schema.Struct({
  waveform: ClipWaveform,
  selectedId: Schema.String,
  // Seconds from the clip's start: where a play starts and a split falls.
  playhead: Schema.Finite,
  play: LevelPlay,
  playsStarted: Schema.Finite,
  maybeDraft: Schema.Option(EdgeDraft),
  draftsMade: Schema.Finite,
  saving: EditSaving,
  // What the last change did, said once.
  maybeNotice: Schema.Option(Schema.String),
})
export type LineEditor = typeof LineEditor.Type

export const initialEditor = (clip: LevelClip): LineEditor => {
  const first = clip.lines[0]
  return {
    waveform: ClipWaveform.Opening(),
    selectedId: first?.id ?? '',
    playhead: first?.from ?? 0,
    play: LevelPlay.Stopped(),
    playsStarted: 0,
    maybeDraft: Option.none(),
    draftsMade: 0,
    saving: EditSaving.Idle(),
    maybeNotice: Option.none(),
  }
}

// How long the keys rest before an edge they moved is kept.
export const keysRestMillis = 500

export const selectedIndexOf = (
  clip: LevelClip,
  editor: Pick<LineEditor, 'selectedId'>,
): number =>
  Math.max(
    0,
    clip.lines.findIndex(line => line.id === editor.selectedId),
  )

export const selectedLineOf = (
  clip: LevelClip,
  editor: Pick<LineEditor, 'selectedId'>,
): Option.Option<LevelLine> =>
  Option.fromNullishOr(clip.lines[selectedIndexOf(clip, editor)])

// The lines' spans with the draft moved as its limits let it.
export const draftedSpans = (
  clip: LevelClip,
  editor: Pick<LineEditor, 'maybeDraft'>,
): ReadonlyArray<Span> =>
  Option.match(editor.maybeDraft, {
    onNone: () => clip.lines,
    onSome: draft => {
      const index = clip.lines.findIndex(line => line.id === draft.lineId)
      return index < 0
        ? clip.lines
        : movedEdge(clip.lines, index, draft.edge, draft.seconds, clip.seconds)
    },
  })

// Line `lineId`'s `edge` moved toward `seconds`, as far as it may go.
export const clampedEdge = (
  clip: LevelClip,
  lineId: string,
  edge: Edge,
  seconds: number,
): number => {
  const index = clip.lines.findIndex(line => line.id === lineId)
  const { least, most } = edgeLimits(clip.lines, index, edge, clip.seconds)
  return Math.min(most, Math.max(least, onSampleGrid(seconds)))
}

// Where an edge is now: its draft, or where it is kept.
export const edgeSecondsOf = (
  clip: LevelClip,
  editor: Pick<LineEditor, 'maybeDraft'>,
  line: LevelLine,
  edge: Edge,
): number =>
  Option.match(editor.maybeDraft, {
    onSome: draft =>
      draft.lineId === line.id && draft.edge === edge
        ? draft.seconds
        : line[edge],
    onNone: () => line[edge],
  })

// The stretch of the clip the waveform shows: the selected line with a
// second and a half either side, at least four seconds, within the clip,
// widened to hold a draft the keys moved past it.
export const editorWindow = (
  clip: LevelClip,
  editor: Pick<LineEditor, 'selectedId' | 'maybeDraft'>,
): Span => {
  const line = clip.lines[selectedIndexOf(clip, editor)]
  if (line === undefined) {
    return { from: 0, to: Math.max(clip.seconds, 1) }
  }
  const spans = draftedSpans(clip, editor)
  const shown = spans[selectedIndexOf(clip, editor)] ?? line
  const lead = 1.5
  const least = 4
  const from = Math.min(line.from, shown.from) - lead
  const to = Math.max(line.to, shown.to) + lead
  const short = Math.max(0, least - (to - from)) / 2
  const wanted = { from: from - short, to: to + short }
  const length = Math.min(clip.seconds, wanted.to - wanted.from)
  const start = Math.min(Math.max(0, wanted.from), clip.seconds - length)
  return { from: start, to: start + length }
}

// The step a key moves an edge or the playhead by, in seconds: 10 ms by
// the arrows, 100 ms by the page keys or the arrows with Shift.
export const keyStep = (
  key: string,
  modifiers: KeyboardModifiers,
): Option.Option<number> => {
  const fine = modifiers.shiftKey ? 0.1 : 0.01
  if (key === 'ArrowRight' || key === 'ArrowUp') {
    return Option.some(fine)
  }
  if (key === 'ArrowLeft' || key === 'ArrowDown') {
    return Option.some(-fine)
  }
  if (key === 'PageUp') {
    return Option.some(0.1)
  }
  if (key === 'PageDown') {
    return Option.some(-0.1)
  }
  return Option.none()
}

// Whether the selected line can be split at the playhead.
export const canSplitAtPlayhead = (
  clip: LevelClip,
  editor: Pick<LineEditor, 'selectedId' | 'playhead'>,
): boolean =>
  Option.match(selectedLineOf(clip, editor), {
    onNone: () => false,
    onSome: line => canSplit(line, editor.playhead),
  })

// Whether the editor takes a change now: the clip is held, no change is
// being kept and no edge is being moved.
export const canChange = (editor: LineEditor): boolean =>
  editor.waveform._tag === 'Ready' &&
  editor.saving._tag !== 'Saving' &&
  Option.isNone(editor.maybeDraft)

export const lineNumberOf = (
  clip: LevelClip,
  lineId: string,
): Option.Option<number> =>
  Option.map(
    Array.findFirst(clip.lines, line => line.id === lineId),
    line => line.number,
  )
