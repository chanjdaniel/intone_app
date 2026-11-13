import { Option } from 'effect'
import {
  Command,
  Mount,
  click,
  expect,
  expectIgnored,
  given,
  keydown,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import type { ClipEntry } from '../../services/history-records'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { LoadLevelStars } from './commands'
import { ClipWaveform, EditSaving, initialEditor } from './editor'
import {
  EditClipLines,
  FocusLineEditor,
  UndoClipLineChange,
  WaitForKeysToRest,
} from './editorCommands'
import { FollowLineEditorPointer } from './editorPointer'
import {
  DeleteState,
  type LevelClip,
  LevelPage,
  LevelStars,
  levelClipOf,
} from './level'

// The line editor through its view: the selected line's edges and the
// playhead are sliders that say their time, step 10 ms and 100 ms by key,
// and are refused while the clip is not held; the changes are named by
// the lines they change; and a marked line says why and what it means.

const quiet = {
  speechFrames: 120,
  confidentShare: 0.7,
  pauseFrames: 20,
  pausePitchedShare: 0,
}

const entry: ClipEntry = {
  format: 1,
  id: 'c1',
  name: 'reading.mp3',
  addedAt: 1,
  seconds: 12,
  audio: { file: 'clips/c1.mp3', type: 'audio/mpeg', bytes: 10 },
  lines: [
    {
      id: '1',
      from: 1,
      to: 3,
      native: { _tag: 'Tracked', nativeId: 'n1' },
      quality: quiet,
    },
    {
      id: '2',
      from: 4,
      to: 6,
      native: { _tag: 'Tracked', nativeId: 'n2' },
      quality: { ...quiet, pausePitchedShare: 0.82 },
    },
    {
      id: '3',
      from: 6.5,
      to: 8,
      native: { _tag: 'Tracked', nativeId: 'n3' },
      quality: { ...quiet, confidentShare: 0.31 },
    },
  ],
}

const onLevel = (
  clip: LevelClip = levelClipOf(entry),
  waveform: ClipWaveform = ClipWaveform.Ready({ peaks: new Uint8Array(1200) }),
): Model => ({
  ...initialModel(AppRoute.Level({ clipId: 'c1', maybeFind: Option.none() })),
  level: LevelPage.Ready({
    stars: LevelStars.Ready({ lines: [] }),
    clip,
    shownRows: 50,
    deleting: DeleteState.Idle(),
    editor: { ...initialEditor(clip), waveform },
  }),
})

const followed = Mount.resolve(
  FollowLineEditorPointer,
  Message.CompletedFollowLineEditorPointer(),
)

const endOfLine1 = role('slider', { name: 'End of Line 1' })

describe('the line editor', () => {
  test('shows the selected line, its edges and the playhead as sliders with their times', () => {
    scene(
      { update, view },
      given(onLevel()),
      followed,
      expect(role('heading', { name: 'Fix the lines', level: 2 })).toExist(),
      expect(text('Line 1 of 3')).toExist(),
      expect(role('slider', { name: 'Start of Line 1' })).toHaveAttr(
        'aria-valuetext',
        '0:01.00',
      ),
      expect(endOfLine1).toHaveAttr('aria-valuetext', '0:03.00'),
      expect(endOfLine1).toHaveAttr('aria-valuemax', '4'),
      expect(role('slider', { name: /^Playhead/ })).toHaveAttr(
        'aria-valuetext',
        '0:01.00',
      ),
    )
  })

  test('steps an edge 10 ms by the arrows and 100 ms with Shift, saying its new time', () => {
    scene(
      { update, view },
      given(onLevel()),
      followed,
      keydown(endOfLine1, 'ArrowRight'),
      expect(endOfLine1).toHaveAttr('aria-valuetext', '0:03.01'),
      Command.resolve(
        WaitForKeysToRest,
        Message.CompletedWaitForKeysToRest({ draftNumber: 1 }),
      ),
      Command.expectExact(
        EditClipLines({
          clipId: 'c1',
          edit: { _tag: 'Move', lineId: '1', edge: 'to', seconds: 3.01 },
        }),
      ),
      Command.resolve(
        EditClipLines,
        Message.FailedEditClipLines({
          clipId: 'c1',
          reason: 'The disk is full.',
        }),
      ),
      expect(text('The change was not kept. The disk is full.')).toExist(),
      expect(endOfLine1).toHaveAttr('aria-valuetext', '0:03.00'),
      keydown(endOfLine1, 'ArrowLeft', { shiftKey: true }),
      expect(endOfLine1).toHaveAttr('aria-valuetext', '0:02.90'),
      Command.resolve(
        WaitForKeysToRest,
        Message.CompletedWaitForKeysToRest({ draftNumber: 2 }),
      ),
      Command.resolve(
        EditClipLines,
        Message.FailedEditClipLines({ clipId: 'c1', reason: 'Stopped.' }),
      ),
      keydown(endOfLine1, 'PageDown'),
      expect(endOfLine1).toHaveAttr('aria-valuetext', '0:02.90'),
      Command.resolve(
        WaitForKeysToRest,
        Message.CompletedWaitForKeysToRest({ draftNumber: 3 }),
      ),
      Command.resolve(
        EditClipLines,
        Message.FailedEditClipLines({ clipId: 'c1', reason: 'Stopped.' }),
      ),
    )
  })

  test('takes no change until the clip is held, and says it is getting it ready', () => {
    scene(
      { update, view },
      given(onLevel(levelClipOf(entry), ClipWaveform.Opening())),
      followed,
      expect(endOfLine1).toHaveAttr('aria-disabled', 'true'),
      expect(text('Getting the clip ready to change its lines…')).toExist(),
      expect(role('button', { name: 'Delete line 1' })).toBeDisabled(),
      keydown(endOfLine1, 'ArrowRight'),
      expectIgnored(),
    )
  })

  test('splits only with the playhead inside the line, away from its edges', () => {
    scene(
      { update, view },
      given(onLevel()),
      followed,
      expect(role('button', { name: 'Split at 0:01.00' })).toBeDisabled(),
      expect(
        text(
          'To split the line, put the playhead inside it, at least a quarter second from its edges.',
        ),
      ).toExist(),
      keydown(role('slider', { name: /^Playhead/ }), 'PageUp'),
      keydown(role('slider', { name: /^Playhead/ }), 'PageUp'),
      keydown(role('slider', { name: /^Playhead/ }), 'PageUp'),
      click(role('button', { name: 'Split at 0:01.30' })),
      Command.expectExact(
        EditClipLines({
          clipId: 'c1',
          edit: { _tag: 'Split', lineId: '1', seconds: 1.3 },
        }),
      ),
      expect(
        text('Finding the pitch of the changed lines and keeping them…'),
      ).toExist(),
      Command.resolve(
        EditClipLines,
        Message.FailedEditClipLines({ clipId: 'c1', reason: 'Stopped.' }),
      ),
    )
  })

  test('names each change by the lines it changes, and offers the one undo', () => {
    const deleted: ClipEntry = {
      ...entry,
      lines: [entry.lines[0], entry.lines[2]].flatMap(line =>
        line === undefined ? [] : [line],
      ),
      undo: { change: { kind: 'Deleted', lineNumber: 2 }, lines: entry.lines },
    }
    scene(
      { update, view },
      given(onLevel(levelClipOf(deleted))),
      followed,
      expect(
        role('button', { name: 'Merge with the line before' }),
      ).toBeDisabled(),
      expect(role('button', { name: 'Merge with line 2' })).toExist(),
      click(role('button', { name: 'Undo deleting line 2' })),
      Command.expectExact(UndoClipLineChange({ clipId: 'c1' })),
      Command.resolve(
        UndoClipLineChange,
        Message.SucceededUndoClipLineChange({
          clipId: 'c1',
          clip: levelClipOf(entry),
        }),
      ),
      Command.resolve(
        LoadLevelStars,
        Message.SucceededLoadLevelStars({ clipId: 'c1', lines: [] }),
      ),
      expect(text('The last change is undone.')).toExist(),
      expect(role('button', { name: /^Undo/ })).not.toExist(),
      expect(text('Line 1 of 3')).toExist(),
    )
  })

  test('a line chosen from the list is selected, played and focused', () => {
    scene(
      { update, view },
      given(onLevel()),
      followed,
      click(role('button', { name: 'Fix line 3' })),
      Command.resolve(FocusLineEditor, Message.CompletedFocusLineEditor()),
      expect(text('Line 3 of 3')).toExist(),
      expect(role('button', { name: 'Stop' })).toExist(),
      expect(role('slider', { name: 'Start of Line 3' })).toHaveAttr(
        'aria-valuetext',
        '0:06.50',
      ),
    )
  })

  test('a marked line says why, in the list and in the editor, and what it means for the match', () => {
    scene(
      { update, view },
      given(onLevel()),
      followed,
      expect(
        role('link', {
          name: /^Line 2, .* Likely music under it: A pitch runs through 82% of its pauses, where no one speaks\./,
        }),
      ).toExist(),
      expect(
        role('link', {
          name: /^Line 3, .* Low pitch confidence: A clear pitch was found in only 31% of its speech\./,
        }),
      ).toExist(),
      click(role('button', { name: 'Line 2' })),
      expect(
        text(
          /the match of a take against it, may follow that sound rather than the voice/,
        ),
      ).toExist(),
      click(role('button', { name: 'Line 3' })),
      expect(
        text(/a take is compared on fewer moments and its match says less/),
      ).toExist(),
    )
  })

  test('says when the clip could not be opened to change, and the lines still play', () => {
    scene(
      { update, view },
      given(
        onLevel(
          levelClipOf(entry),
          ClipWaveform.Failed({ reason: 'This browser cannot decode it.' }),
        ),
      ),
      followed,
      expect(
        text(
          'The clip could not be opened to change its lines. This browser cannot decode it. Its lines can still be copied.',
        ),
      ).toExist(),
      expect(role('button', { name: 'Play line 1' })).toExist(),
      expect(role('link', { name: /^Line 1/ })).toHaveAttr(
        'href',
        '/line/c1/1',
      ),
    )
  })

  test('a change being kept takes no other', () => {
    const busy = onLevel()
    scene(
      { update, view },
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
      followed,
      expect(role('button', { name: 'Delete line 1' })).toBeDisabled(),
      expect(role('button', { name: 'Merge with line 2' })).toBeDisabled(),
      expect(endOfLine1).toHaveAttr('aria-disabled', 'true'),
    )
  })
})
