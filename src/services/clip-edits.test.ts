import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { shortestLineSeconds } from '../engine/cut/edit'
import { type LineEdit, planEdit, undoneOf } from './clip-edits'
import type { ClipEntry, ClipLine } from './history-records'

const tracked = (id: string, from: number, to: number): ClipLine => ({
  id,
  from,
  to,
  native: { _tag: 'Tracked', nativeId: `native-${id}` },
})

const clip: ClipEntry = {
  format: 1,
  id: 'clip',
  name: 'reading.wav',
  addedAt: 0,
  seconds: 12,
  audio: { file: 'clips/clip.wav', type: 'audio/wav', bytes: 10 },
  lines: [
    tracked('1', 1, 3),
    tracked('2', 4, 6),
    { id: '3', from: 6, to: 8, native: { _tag: 'TooNoisy' } },
  ],
}

const plan = (edit: LineEdit, on: ClipEntry = clip) =>
  Option.getOrThrow(planEdit(on, edit))

describe('planning a change to a clip’s lines', () => {
  test('a moved edge tracks only the line it moved again', () => {
    const planned = plan({
      _tag: 'Move',
      lineId: '1',
      edge: 'to',
      seconds: 3.5,
    })
    expect(planned.lines).toStrictEqual([
      { _tag: 'Retrack', id: '1', from: 1, to: 3.5 },
      { _tag: 'Kept', line: clip.lines[1] },
      { _tag: 'Kept', line: clip.lines[2] },
    ])
    expect(planned.undo).toStrictEqual({
      change: { kind: 'Moved', lineNumber: 1 },
      lines: clip.lines,
    })
    expect(planned.nextLineId).toBe(4)
  })

  test('an edge two lines share moves both, and both are tracked again', () => {
    const planned = plan({
      _tag: 'Move',
      lineId: '3',
      edge: 'from',
      seconds: 5.5,
    })
    expect(planned.lines.map(line => line._tag)).toStrictEqual([
      'Kept',
      'Retrack',
      'Retrack',
    ])
    expect(planned.lines[1]).toStrictEqual({
      _tag: 'Retrack',
      id: '2',
      from: 4,
      to: 5.5,
    })
  })

  test('an edge that cannot move changes nothing', () => {
    expect(
      Option.isNone(
        planEdit(clip, { _tag: 'Move', lineId: '1', edge: 'from', seconds: 1 }),
      ),
    ).toBe(true)
    const atStart: ClipEntry = { ...clip, lines: [tracked('1', 0, 3)] }
    expect(
      Option.isNone(
        planEdit(atStart, {
          _tag: 'Move',
          lineId: '1',
          edge: 'from',
          seconds: -1,
        }),
      ),
    ).toBe(true)
  })

  test('a split keeps the first part’s id, gives the second the next one, and tracks both', () => {
    const planned = plan({ _tag: 'Split', lineId: '2', seconds: 5 })
    expect(planned.lines).toStrictEqual([
      { _tag: 'Kept', line: clip.lines[0] },
      { _tag: 'Retrack', id: '2', from: 4, to: 5 },
      { _tag: 'Retrack', id: '4', from: 5, to: 6 },
      { _tag: 'Kept', line: clip.lines[2] },
    ])
    expect(planned.nextLineId).toBe(5)
    expect(planned.undo.change).toStrictEqual({ kind: 'Split', lineNumber: 2 })
  })

  test('ids are never used again, after a split is undone too', () => {
    const split = plan({ _tag: 'Split', lineId: '1', seconds: 2 })
    const after: ClipEntry = { ...clip, nextLineId: split.nextLineId }
    expect(
      plan({ _tag: 'Split', lineId: '2', seconds: 5 }, after).lines[2],
    ).toMatchObject({
      id: '5',
    })
  })

  test('a split too near an edge is refused', () => {
    expect(
      Option.isNone(
        planEdit(clip, {
          _tag: 'Split',
          lineId: '1',
          seconds: 1 + shortestLineSeconds / 2,
        }),
      ),
    ).toBe(true)
  })

  test('two neighbours merge into the first, the pause with them, tracked again', () => {
    const planned = plan({ _tag: 'Merge', lineId: '1' })
    expect(planned.lines).toStrictEqual([
      { _tag: 'Retrack', id: '1', from: 1, to: 6 },
      { _tag: 'Kept', line: clip.lines[2] },
    ])
    expect(planned.undo.change).toStrictEqual({ kind: 'Merged', lineNumber: 1 })
    expect(Option.isNone(planEdit(clip, { _tag: 'Merge', lineId: '3' }))).toBe(
      true,
    )
  })

  test('a deleted line goes, and nothing is tracked again', () => {
    const planned = plan({ _tag: 'Delete', lineId: '2' })
    expect(planned.lines).toStrictEqual([
      { _tag: 'Kept', line: clip.lines[0] },
      { _tag: 'Kept', line: clip.lines[2] },
    ])
    expect(planned.undo.change).toStrictEqual({
      kind: 'Deleted',
      lineNumber: 2,
    })
  })

  test('the last line cannot be deleted', () => {
    expect(
      Option.isNone(
        planEdit(
          { ...clip, lines: [tracked('1', 1, 3)] },
          { _tag: 'Delete', lineId: '1' },
        ),
      ),
    ).toBe(true)
  })

  test('a line that is not there changes nothing', () => {
    expect(Option.isNone(planEdit(clip, { _tag: 'Delete', lineId: '9' }))).toBe(
      true,
    )
  })
})

describe('undoing the last change', () => {
  test('gives back the lines as they were, and leaves nothing to undo', () => {
    const before = plan({ _tag: 'Delete', lineId: '2' })
    const edited: ClipEntry = {
      ...clip,
      lines: [clip.lines[0], clip.lines[2]].flatMap(line =>
        line === undefined ? [] : [line],
      ),
      nextLineId: before.nextLineId,
      undo: before.undo,
    }
    const undone = Option.getOrThrow(undoneOf(edited))
    expect(undone.lines).toStrictEqual(clip.lines)
    expect(undone.undo).toBeUndefined()
    expect(undone.nextLineId).toBe(before.nextLineId)
    expect(Option.isNone(undoneOf(undone))).toBe(true)
  })
})
