import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { shortestLineSeconds } from '../../engine/cut/edit'
import { type LineEdit, planEdit, undoneOf } from '../../services/clip-edits'
import type { ClipEntry } from '../../services/history-records'
import { LineHistoryPage } from '../history/history'
import { NativeCurve } from '../line/native'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { LoadLevelStars } from './commands'
import { ClipWaveform, EditSaving, LevelPlay, initialEditor } from './editor'
import {
  EditClipLines,
  FocusLineEditor,
  UndoClipLineChange,
  WaitForKeysToRest,
} from './editorCommands'
import {
  DeleteState,
  type LevelClip,
  LevelPage,
  LevelStars,
  levelClipOf,
} from './level'
import { levelResources } from './resources'

// The line editor's Model (ticket 14): an edge dragged or stepped by key
// is a draft until it is let go or the keys rest; a split, a merge and a
// delete each ask for one change, the lines it moves tracked again
// before it is kept; the last change is undone once; and while one
// change is being kept no other is asked for. The clips that come back
// are made by the history's own planning (../../services/clip-edits.ts).

// Three lines of a 12 s clip, the second and third touching, as a split
// leaves them.
const entry: ClipEntry = {
  format: 1,
  id: 'c1',
  name: 'reading.mp3',
  addedAt: 1,
  seconds: 12,
  audio: { file: 'clips/c1.mp3', type: 'audio/mpeg', bytes: 10 },
  lines: [
    { id: '1', from: 1, to: 3, native: { _tag: 'Tracked', nativeId: 'n1' } },
    { id: '2', from: 4, to: 6, native: { _tag: 'Tracked', nativeId: 'n2' } },
    { id: '3', from: 6, to: 8, native: { _tag: 'Tracked', nativeId: 'n3' } },
  ],
}
const clip = levelClipOf(entry)

// The clip as the history keeps it after `edit` on `before`, each line
// it tracked again given a new curve.
const edited = (before: ClipEntry, edit: LineEdit): ClipEntry => {
  const plan = Option.getOrThrow(planEdit(before, edit))
  return {
    ...before,
    lines: plan.lines.map(line =>
      line._tag === 'Kept'
        ? line.line
        : {
            id: line.id,
            from: line.from,
            to: line.to,
            native: { _tag: 'Tracked', nativeId: `n${line.id}-${line.from}` },
          },
    ),
    nextLineId: plan.nextLineId,
    undo: plan.undo,
  }
}

const peaks = new Uint8Array(1200)

const onLevel = (shown: LevelClip = clip, held = true): Model => ({
  ...initialModel(AppRoute.Level({ clipId: 'c1', maybeFind: Option.none() })),
  level: LevelPage.Ready({
    stars: LevelStars.Ready({ lines: [] }),
    clip: shown,
    shownRows: 50,
    deleting: DeleteState.Idle(),
    editor: {
      ...initialEditor(shown),
      waveform: held ? ClipWaveform.Ready({ peaks }) : ClipWaveform.Opening(),
    },
  }),
})

const editorOf = (current: Model) => {
  if (current.level._tag !== 'Ready') {
    throw new Error('The level is not open.')
  }
  return current.level.editor
}

const clipOf = (current: Model) => {
  if (current.level._tag !== 'Ready') {
    throw new Error('The level is not open.')
  }
  return current.level.clip
}

const lineIds = (current: Model) => clipOf(current).lines.map(line => line.id)

describe('moving a line’s edge', () => {
  test('waits for the clip Worker to hold the clip', () => {
    story(
      update,
      given(onLevel(clip, false)),
      message(
        Message.MovedLineEdge({
          lineId: '1',
          edge: 'to',
          seconds: 3.2,
        }),
      ),
      model(current =>
        expect(editorOf(current).maybeDraft).toStrictEqual(Option.none()),
      ),
      message(Message.AcquiredClipEditor({ clipId: 'c1', peaks })),
      message(
        Message.MovedLineEdge({
          lineId: '1',
          edge: 'to',
          seconds: 3.2,
        }),
      ),
      model(current =>
        expect(editorOf(current).maybeDraft).toMatchObject(
          Option.some({ lineId: '1', edge: 'to', seconds: 3.2 }),
        ),
      ),
    )
  })

  test('by the pointer: a draft that follows it, stops at the neighbour, and is kept when it lets go', () => {
    const moved = edited(entry, {
      _tag: 'Move',
      lineId: '1',
      edge: 'to',
      seconds: 4,
    })
    story(
      update,
      given({
        ...onLevel(),
        native: NativeCurve.Failed({
          clipId: 'c1',
          lineId: '1',
          failure: 'Failed',
          reason: 'old',
        }),
        lineHistory: LineHistoryPage.Empty({ clipId: 'c1', lineId: '1' }),
      }),
      message(
        Message.MovedLineEdge({
          lineId: '1',
          edge: 'to',
          seconds: 3.5,
        }),
      ),
      message(
        Message.MovedLineEdge({
          lineId: '1',
          edge: 'to',
          seconds: 5.5,
        }),
      ),
      model(current =>
        expect(editorOf(current).maybeDraft).toMatchObject(
          Option.some({ seconds: 4 }),
        ),
      ),
      Command.expectNone(),
      message(Message.ReleasedLineEdge()),
      Command.expectExact(
        EditClipLines({
          clipId: 'c1',
          edit: { _tag: 'Move', lineId: '1', edge: 'to', seconds: 4 },
        }),
      ),
      model(current => expect(editorOf(current).saving._tag).toBe('Saving')),
      Command.resolve(
        EditClipLines,
        Message.SucceededEditClipLines({
          clipId: 'c1',
          clip: levelClipOf(moved),
        }),
      ),
      Command.resolve(
        LoadLevelStars,
        Message.SucceededLoadLevelStars({ clipId: 'c1', lines: [] }),
      ),
      model(current => {
        expect(clipOf(current).lines[0]).toMatchObject({ from: 1, to: 4 })
        expect(editorOf(current).maybeDraft).toStrictEqual(Option.none())
        expect(editorOf(current).saving).toStrictEqual(EditSaving.Idle())
        expect(editorOf(current).maybeNotice).toStrictEqual(
          Option.some('Line 1’s end moved to 0:04.00.'),
        )
        expect(clipOf(current).maybeUndo).toStrictEqual(
          Option.some({ kind: 'Moved', lineNumber: 1 }),
        )
        expect(current.native).toStrictEqual(NativeCurve.NoLine())
        expect(current.lineHistory).toStrictEqual(LineHistoryPage.NotLoaded())
      }),
    )
  })

  test('by the keys: each step a draft, kept once the keys rest', () => {
    story(
      update,
      given(onLevel()),
      message(
        Message.SteppedLineEdge({ lineId: '2', edge: 'from', step: -0.11 }),
      ),
      Command.expectExact(WaitForKeysToRest({ draftNumber: 1 })),
      model(current =>
        expect(editorOf(current).saving).toStrictEqual(EditSaving.Idle()),
      ),
      Command.resolve(
        WaitForKeysToRest,
        Message.CompletedWaitForKeysToRest({ draftNumber: 1 }),
      ),
      Command.expectExact(
        EditClipLines({
          clipId: 'c1',
          edit: { _tag: 'Move', lineId: '2', edge: 'from', seconds: 3.89 },
        }),
      ),
      Command.resolve(
        EditClipLines,
        Message.SucceededEditClipLines({
          clipId: 'c1',
          clip: levelClipOf(
            edited(entry, {
              _tag: 'Move',
              lineId: '2',
              edge: 'from',
              seconds: 3.89,
            }),
          ),
        }),
      ),
      Command.resolve(
        LoadLevelStars,
        Message.SucceededLoadLevelStars({ clipId: 'c1', lines: [] }),
      ),
      model(current =>
        expect(clipOf(current).lines[1]).toMatchObject({ from: 3.89, to: 6 }),
      ),
    )
  })

  test('each key’s step adds to where the edge is now, so fast keys each count', () => {
    const stepped = onLevel()
    story(
      update,
      given({
        ...stepped,
        level:
          stepped.level._tag === 'Ready'
            ? {
                ...stepped.level,
                editor: {
                  ...stepped.level.editor,
                  maybeDraft: Option.some({
                    lineId: '1',
                    edge: 'to' as const,
                    seconds: 3.02,
                    draftNumber: 2,
                    by: 'Keyboard' as const,
                  }),
                  draftsMade: 2,
                },
              }
            : stepped.level,
      }),
      message(Message.SteppedLineEdge({ lineId: '1', edge: 'to', step: 0.01 })),
      model(current =>
        expect(editorOf(current).maybeDraft).toMatchObject(
          Option.some({ seconds: 3.03, draftNumber: 3 }),
        ),
      ),
      Command.resolve(
        WaitForKeysToRest,
        Message.CompletedWaitForKeysToRest({ draftNumber: 3 }),
      ),
      Command.resolve(
        EditClipLines,
        Message.FailedEditClipLines({ clipId: 'c1', reason: 'Stopped.' }),
      ),
      message(Message.SteppedLevelPlayhead({ step: 0.1 })),
      message(Message.SteppedLevelPlayhead({ step: 0.1 })),
      model(current => expect(editorOf(current).playhead).toBe(1.2)),
    )
  })

  test('a rest after an earlier key keeps nothing: only the last key’s rest does', () => {
    const stepped = onLevel()
    story(
      update,
      given({
        ...stepped,
        level:
          stepped.level._tag === 'Ready'
            ? {
                ...stepped.level,
                editor: {
                  ...stepped.level.editor,
                  maybeDraft: Option.some({
                    lineId: '2',
                    edge: 'from' as const,
                    seconds: 3.98,
                    draftNumber: 2,
                    by: 'Keyboard' as const,
                  }),
                  draftsMade: 2,
                },
              }
            : stepped.level,
      }),
      message(Message.CompletedWaitForKeysToRest({ draftNumber: 1 })),
      Command.expectNone(),
      message(Message.CompletedWaitForKeysToRest({ draftNumber: 2 })),
      Command.expectExact(
        EditClipLines({
          clipId: 'c1',
          edit: { _tag: 'Move', lineId: '2', edge: 'from', seconds: 3.98 },
        }),
      ),
      Command.resolve(
        EditClipLines,
        Message.FailedEditClipLines({ clipId: 'c1', reason: 'Stopped.' }),
      ),
    )
  })

  test('an edge two lines share moves as one, and a draft back where it was keeps nothing', () => {
    story(
      update,
      given(onLevel()),
      message(
        Message.MovedLineEdge({
          lineId: '3',
          edge: 'from',
          seconds: 5,
        }),
      ),
      model(current =>
        expect(editorOf(current).maybeDraft).toMatchObject(
          Option.some({ seconds: 5 }),
        ),
      ),
      message(
        Message.MovedLineEdge({
          lineId: '3',
          edge: 'from',
          seconds: 6,
        }),
      ),
      message(Message.ReleasedLineEdge()),
      Command.expectNone(),
      model(current =>
        expect(editorOf(current).maybeDraft).toStrictEqual(Option.none()),
      ),
    )
  })
})

describe('splitting, merging and deleting', () => {
  test('a line splits at the playhead into two, and stays selected', () => {
    const split = edited(entry, { _tag: 'Split', lineId: '1', seconds: 2 })
    story(
      update,
      given(onLevel()),
      message(
        Message.PlacedLevelPlayhead({ seconds: 1 + shortestLineSeconds / 2 }),
      ),
      message(Message.ClickedSplitLine()),
      Command.expectNone(),
      message(Message.PlacedLevelPlayhead({ seconds: 2 })),
      message(Message.ClickedSplitLine()),
      Command.expectExact(
        EditClipLines({
          clipId: 'c1',
          edit: { _tag: 'Split', lineId: '1', seconds: 2 },
        }),
      ),
      Command.resolve(
        EditClipLines,
        Message.SucceededEditClipLines({
          clipId: 'c1',
          clip: levelClipOf(split),
        }),
      ),
      Command.resolve(
        LoadLevelStars,
        Message.SucceededLoadLevelStars({ clipId: 'c1', lines: [] }),
      ),
      model(current => {
        expect(lineIds(current)).toStrictEqual(['1', '4', '2', '3'])
        expect(clipOf(current).lines.map(line => line.number)).toStrictEqual([
          1, 2, 3, 4,
        ])
        expect(editorOf(current).selectedId).toBe('1')
        expect(editorOf(current).maybeNotice).toStrictEqual(
          Option.some('Line 1 is split at 0:02.00, into lines 1 and 2.'),
        )
      }),
    )
  })

  test('two neighbours merge into the first, whichever was selected', () => {
    const merged = edited(entry, { _tag: 'Merge', lineId: '1' })
    story(
      update,
      given(onLevel()),
      message(Message.SelectedLevelLine({ lineId: '2' })),
      message(Message.ClickedMergeLines({ lineId: '1', select: '1' })),
      Command.expectExact(
        EditClipLines({ clipId: 'c1', edit: { _tag: 'Merge', lineId: '1' } }),
      ),
      Command.resolve(
        EditClipLines,
        Message.SucceededEditClipLines({
          clipId: 'c1',
          clip: levelClipOf(merged),
        }),
      ),
      Command.resolve(
        LoadLevelStars,
        Message.SucceededLoadLevelStars({ clipId: 'c1', lines: [] }),
      ),
      model(current => {
        expect(lineIds(current)).toStrictEqual(['1', '3'])
        expect(clipOf(current).lines[0]).toMatchObject({ from: 1, to: 6 })
        expect(editorOf(current).selectedId).toBe('1')
        expect(editorOf(current).play).toStrictEqual(LevelPlay.Stopped())
      }),
    )
  })

  test('a deleted line goes, the next is selected, and its takes are kept', () => {
    const deleted = edited(entry, { _tag: 'Delete', lineId: '2' })
    story(
      update,
      given(onLevel()),
      message(Message.SelectedLevelLine({ lineId: '2' })),
      message(Message.ClickedDeleteLine()),
      Command.expectExact(
        EditClipLines({ clipId: 'c1', edit: { _tag: 'Delete', lineId: '2' } }),
      ),
      Command.resolve(
        EditClipLines,
        Message.SucceededEditClipLines({
          clipId: 'c1',
          clip: levelClipOf(deleted),
        }),
      ),
      Command.resolve(
        LoadLevelStars,
        Message.SucceededLoadLevelStars({ clipId: 'c1', lines: [] }),
      ),
      model(current => {
        expect(lineIds(current)).toStrictEqual(['1', '3'])
        expect(editorOf(current).selectedId).toBe('3')
        expect(editorOf(current).maybeNotice).toStrictEqual(
          Option.some(
            'Line 2 is deleted. Your takes of it are kept in your history.',
          ),
        )
      }),
    )
  })

  test('no other change is asked for while one is being kept', () => {
    const busy = onLevel()
    story(
      update,
      given({
        ...busy,
        level:
          busy.level._tag === 'Ready'
            ? {
                ...busy.level,
                editor: {
                  ...busy.level.editor,
                  saving: EditSaving.Saving({
                    maybeSelect: Option.none(),
                    index: 0,
                    notice: '',
                  }),
                },
              }
            : busy.level,
      }),
      message(Message.ClickedDeleteLine()),
      message(Message.ClickedMergeLines({ lineId: '1', select: '1' })),
      message(
        Message.MovedLineEdge({
          lineId: '1',
          edge: 'to',
          seconds: 3.5,
        }),
      ),
      message(Message.ClickedUndoLineChange()),
      Command.expectNone(),
      model(current =>
        expect(editorOf(current).maybeDraft).toStrictEqual(Option.none()),
      ),
    )
  })

  test('the only line cannot be deleted', () => {
    const one = levelClipOf({ ...entry, lines: entry.lines.slice(0, 1) })
    story(
      update,
      given(onLevel(one)),
      message(Message.ClickedDeleteLine()),
      Command.expectNone(),
    )
  })

  test('a change that was not kept says why, and leaves the lines as they were', () => {
    story(
      update,
      given(onLevel()),
      message(Message.ClickedDeleteLine()),
      Command.resolve(
        EditClipLines,
        Message.FailedEditClipLines({
          clipId: 'c1',
          reason: 'The disk is full.',
        }),
      ),
      model(current => {
        expect(lineIds(current)).toStrictEqual(['1', '2', '3'])
        expect(editorOf(current).saving).toStrictEqual(
          EditSaving.Failed({ reason: 'The disk is full.' }),
        )
      }),
    )
  })
})

describe('undoing', () => {
  test('undoes the last change once, and then has nothing to undo', () => {
    const deleted = edited(entry, { _tag: 'Delete', lineId: '2' })
    const undone = Option.getOrThrow(undoneOf(deleted))
    story(
      update,
      given(onLevel(levelClipOf(deleted))),
      message(Message.ClickedUndoLineChange()),
      Command.expectExact(UndoClipLineChange({ clipId: 'c1' })),
      Command.resolve(
        UndoClipLineChange,
        Message.SucceededUndoClipLineChange({
          clipId: 'c1',
          clip: levelClipOf(undone),
        }),
      ),
      Command.resolve(
        LoadLevelStars,
        Message.SucceededLoadLevelStars({ clipId: 'c1', lines: [] }),
      ),
      model(current => {
        expect(lineIds(current)).toStrictEqual(['1', '2', '3'])
        expect(clipOf(current).maybeUndo).toStrictEqual(Option.none())
        expect(editorOf(current).maybeNotice).toStrictEqual(
          Option.some('The last change is undone.'),
        )
      }),
      message(Message.ClickedUndoLineChange()),
      Command.expectNone(),
    )
  })
})

describe('playing a line', () => {
  test('selecting a line plays it from its start, and the playhead follows the play', () => {
    story(
      update,
      given(onLevel()),
      message(Message.SelectedLevelLine({ lineId: '2' })),
      model(current => {
        expect(editorOf(current).selectedId).toBe('2')
        expect(editorOf(current).play).toStrictEqual(
          LevelPlay.Playing({ playNumber: 1, from: 4, to: 6 }),
        )
      }),
      message(Message.MovedLevelPlayhead({ playNumber: 1, seconds: 4.5 })),
      message(Message.MovedLevelPlayhead({ playNumber: 0, seconds: 9 })),
      model(current => expect(editorOf(current).playhead).toBe(4.5)),
      message(Message.EndedLevelPlayback({ playNumber: 1 })),
      model(current =>
        expect(editorOf(current).play).toStrictEqual(LevelPlay.Stopped()),
      ),
    )
  })

  test('from the list it also moves the focus to the editor', () => {
    story(
      update,
      given(onLevel()),
      message(Message.ClickedEditLevelLine({ lineId: '3' })),
      Command.expectExact(FocusLineEditor()),
      Command.resolve(FocusLineEditor, Message.CompletedFocusLineEditor()),
      model(current => expect(editorOf(current).selectedId).toBe('3')),
    )
  })

  test('plays from the playhead inside the line, else from its start, and stops', () => {
    story(
      update,
      given(onLevel()),
      message(Message.PlacedLevelPlayhead({ seconds: 2.5 })),
      message(Message.ClickedPlayLevelLine()),
      model(current =>
        expect(editorOf(current).play).toStrictEqual(
          LevelPlay.Playing({ playNumber: 1, from: 2.5, to: 3 }),
        ),
      ),
      message(Message.ClickedStopLevelLine()),
      message(Message.PlacedLevelPlayhead({ seconds: 9 })),
      message(Message.ClickedPlayLevelLine()),
      model(current =>
        expect(editorOf(current).play).toStrictEqual(
          LevelPlay.Playing({ playNumber: 2, from: 1, to: 3 }),
        ),
      ),
    )
  })

  test('a change stops a play, and leaving the level lets the clip Worker go', () => {
    story(
      update,
      given(onLevel()),
      message(Message.SelectedLevelLine({ lineId: '1' })),
      message(Message.ClickedDeleteLine()),
      model(current =>
        expect(editorOf(current).play).toStrictEqual(LevelPlay.Stopped()),
      ),
      Command.resolve(
        EditClipLines,
        Message.FailedEditClipLines({ clipId: 'c1', reason: 'Left.' }),
      ),
      message(Message.ReleasedClipEditor()),
      model(current =>
        expect(editorOf(current).waveform).toStrictEqual(ClipWaveform.Closed()),
      ),
    )
  })
})

describe('opening the editor', () => {
  const shut = (): Model => {
    const level = onLevel()
    if (level.level._tag !== 'Ready') {
      throw new Error('The level is not open.')
    }
    return {
      ...level,
      level: {
        ...level.level,
        editor: initialEditor(level.level.clip),
      },
    }
  }
  const needsClip = (current: Model) =>
    Option.isSome(levelResources.clipEditor.modelToMaybeRequirements(current))

  test('an upload’s level holds no clip until the editor is opened, so a level opened to practise decodes nothing', () => {
    story(
      update,
      given(shut()),
      model(current => {
        expect(editorOf(current).waveform).toStrictEqual(ClipWaveform.Closed())
        expect(needsClip(current)).toBe(false)
      }),
      message(Message.ClickedOpenLineEditor()),
      Command.resolve(FocusLineEditor, Message.CompletedFocusLineEditor()),
      model(current => {
        expect(editorOf(current).waveform).toStrictEqual(ClipWaveform.Opening())
        expect(needsClip(current)).toBe(true)
      }),
    )
  })

  test('fixing a line from the list opens the editor at that line', () => {
    story(
      update,
      given(shut()),
      message(Message.ClickedEditLevelLine({ lineId: '2' })),
      Command.resolve(FocusLineEditor, Message.CompletedFocusLineEditor()),
      model(current => {
        expect(editorOf(current).selectedId).toBe('2')
        expect(needsClip(current)).toBe(true)
      }),
    )
  })
})
