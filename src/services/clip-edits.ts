import { Array, Option, Schema } from 'effect'

import {
  type Span,
  canSplit,
  mergedSpan,
  movedEdge,
  splitSpans,
} from '../engine/cut/edit'
import type {
  ClipEntry,
  ClipLine,
  ClipUndo,
  LineChange,
} from './history-records'

// A change the learner makes to a kept clip's lines (ticket 14), planned
// on its entry before anything is tracked or written: which lines stay
// as they are, which are tracked again from their new spans, the id the
// next split will give, and what undoing it gives back. The spans'
// rules are ../engine/cut/edit.ts's.

export const LineEdit = Schema.Union([
  // Line `lineId`'s edge moved to `seconds` from the clip's start, as
  // near as its neighbours and the shortest line let it.
  Schema.TaggedStruct('Move', {
    lineId: Schema.String,
    edge: Schema.Literals(['from', 'to']),
    seconds: Schema.Finite,
  }),
  Schema.TaggedStruct('Split', {
    lineId: Schema.String,
    seconds: Schema.Finite,
  }),
  // Line `lineId` and the line after it, as one.
  Schema.TaggedStruct('Merge', { lineId: Schema.String }),
  Schema.TaggedStruct('Delete', { lineId: Schema.String }),
])
export type LineEdit = typeof LineEdit.Type

// A line after the change: as it was, or at a new span to be tracked
// again.
export type PlannedLine =
  | Readonly<{ _tag: 'Kept'; line: ClipLine }>
  | Readonly<{ _tag: 'Retrack'; id: string; from: number; to: number }>

export type PlannedEdit = Readonly<{
  lines: ReadonlyArray<PlannedLine>
  nextLineId: number
  undo: ClipUndo
}>

// A clip that has never been split has the ids its cut gave, 1 to n.
export const nextLineIdOf = (clip: ClipEntry): number =>
  clip.nextLineId ?? clip.lines.length + 1

const kept = (line: ClipLine): PlannedLine => ({ _tag: 'Kept', line })

const retrack = (id: string, span: Span): PlannedLine => ({
  _tag: 'Retrack',
  id,
  from: span.from,
  to: span.to,
})

const sameSpan = (a: Span, b: Span): boolean =>
  a.from === b.from && a.to === b.to

// The plan for `edit` on `clip`, or none when it would change nothing or
// cannot be made: a line that is not there, a split too near an edge, a
// merge of the last line, deleting the only one.
export const planEdit = (
  clip: ClipEntry,
  edit: LineEdit,
): Option.Option<PlannedEdit> =>
  Option.flatMap(
    Array.findFirstIndex(clip.lines, line => line.id === edit.lineId),
    index => {
      const line = clip.lines[index]
      if (line === undefined) {
        return Option.none()
      }
      const nextLineId = nextLineIdOf(clip)
      const planned = (
        kind: LineChange['kind'],
        lines: ReadonlyArray<PlannedLine>,
        next = nextLineId,
      ): Option.Option<PlannedEdit> =>
        Option.some({
          lines,
          nextLineId: next,
          undo: { change: { kind, lineNumber: index + 1 }, lines: clip.lines },
        })
      if (edit._tag === 'Move') {
        const spans = movedEdge(
          clip.lines,
          index,
          edit.edge,
          edit.seconds,
          clip.seconds,
        )
        const lines = clip.lines.map((before, k) => {
          const after = spans[k] ?? before
          return sameSpan(before, after)
            ? kept(before)
            : retrack(before.id, after)
        })
        return Array.some(lines, planned => planned._tag === 'Retrack')
          ? planned('Moved', lines)
          : Option.none()
      }
      if (edit._tag === 'Split') {
        if (!canSplit(line, edit.seconds)) {
          return Option.none()
        }
        const [first, second] = splitSpans(line, edit.seconds)
        return planned(
          'Split',
          clip.lines.flatMap((other, k) =>
            k === index
              ? [retrack(line.id, first), retrack(String(nextLineId), second)]
              : [kept(other)],
          ),
          nextLineId + 1,
        )
      }
      if (edit._tag === 'Merge') {
        const after = clip.lines[index + 1]
        return after === undefined
          ? Option.none()
          : planned(
              'Merged',
              clip.lines.flatMap((other, k) =>
                k === index
                  ? [retrack(line.id, mergedSpan(line, after))]
                  : k === index + 1
                    ? []
                    : [kept(other)],
              ),
            )
      }
      return clip.lines.length < 2
        ? Option.none()
        : planned(
            'Deleted',
            clip.lines.flatMap((other, k) =>
              k === index ? [] : [kept(other)],
            ),
          )
    },
  )

// `clip` with its last change undone, or none when it has none to undo.
// Undoing is once: what it undid cannot be done again but by hand.
export const undoneOf = (clip: ClipEntry): Option.Option<ClipEntry> =>
  clip.undo === undefined
    ? Option.none()
    : Option.some({
        format: clip.format,
        id: clip.id,
        name: clip.name,
        addedAt: clip.addedAt,
        seconds: clip.seconds,
        audio: clip.audio,
        lines: clip.undo.lines,
        nextLineId: nextLineIdOf(clip),
      })
