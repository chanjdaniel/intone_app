import { Option } from 'effect'
import {
  Command,
  Mount,
  all,
  click,
  expect,
  expectAll,
  given,
  label,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { DeleteClip, FocusLevelRow } from './commands'
import { initialEditor } from './editor'
import { FollowLineEditorPointer } from './editorPointer'
import {
  ClipsPage,
  DeleteState,
  LevelPage,
  LevelStars,
  levelRowsPerPage,
} from './level'
import { sampleClip } from './testClips'

const onLevel = (
  clip = sampleClip(3),
  maybeFind: Option.Option<string> = Option.none(),
): Model => ({
  ...initialModel(AppRoute.Level({ clipId: clip.id, maybeFind })),
  level: LevelPage.Ready({
    stars: LevelStars.Ready({ lines: [] }),
    clip,
    shownRows: levelRowsPerPage,
    deleting: DeleteState.Idle(),
    editor: initialEditor(clip),
  }),
})

const rows = all.role('link', { name: /^Line \d+/ })

const pointerFollowed = Mount.resolve(
  FollowLineEditorPointer,
  Message.CompletedFollowLineEditorPointer(),
)

const dialogShown = [
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  Mount.resolve(
    Dialog.AcquireResources,
    Dialog.Message.SucceededAcquireResources(),
  ),
] as const

describe('/level/:clipId', () => {
  test('names the clip and lists its lines, each opening its practice screen', () => {
    scene(
      { update, view },
      given(onLevel()),
      pointerFollowed,
      expect(role('heading', { name: 'reading.mp3', level: 1 })).toExist(),
      expect(
        text('3 lines from 10.0 s of audio, kept on this device.'),
      ).toExist(),
      expect(role('link', { name: /^Line 1, 0:00.4 to 0:02.9/ })).toHaveAttr(
        'href',
        '/line/c1/1',
      ),
      expect(role('link', { name: /^Line 3/ })).toHaveAttr(
        'href',
        '/line/c1/3',
      ),
    )
  })

  test('marks a line with no pitch to copy, and does not link it', () => {
    scene(
      { update, view },
      given(onLevel()),
      pointerFollowed,
      expect(role('link', { name: /^Line 2/ })).not.toExist(),
      expect(text('Too quiet to find its pitch')).toExist(),
    )
  })

  test('says when the clip’s audio is not on this device, and links no line', () => {
    scene(
      { update, view },
      given(onLevel(sampleClip(3, false))),
      expect(text(/came from a backup that left its audio out/)).toExist(),
      expectAll(rows).toBeEmpty(),
    )
  })

  test('has no find field for a few lines', () => {
    scene(
      { update, view },
      given(onLevel(sampleClip(12))),
      pointerFollowed,
      expect(label('Find a line')).not.toExist(),
      expectAll(rows).toHaveCount(11),
    )
  })

  test('a long clip shows 50 rows, a find field, and more on request', () => {
    scene(
      { update, view },
      given(onLevel(sampleClip(120))),
      pointerFollowed,
      expect(label('Find a line')).toExist(),
      expect(text('120 lines')).toExist(),
      expectAll(rows).toHaveCount(49),
      click(role('button', { name: 'Show 50 more' })),
      Command.resolve(FocusLevelRow, Message.CompletedFocusLevelRow()),
      expectAll(rows).toHaveCount(99),
      click(role('button', { name: 'Show 20 more' })),
      Command.resolve(FocusLevelRow, Message.CompletedFocusLevelRow()),
      expect(role('button', { name: /^Show/ })).not.toExist(),
    )
  })

  test('finds lines by their number or time, from the words in the address', () => {
    scene(
      { update, view },
      given(onLevel(sampleClip(120), Option.some('Line 11'))),
      pointerFollowed,
      expect(text('11 lines of 120 found for “Line 11”')).toExist(),
      expect(label('Find a line')).toHaveValue('Line 11'),
    )
    scene(
      { update, view },
      given(onLevel(sampleClip(120), Option.some('5:00'))),
      pointerFollowed,
      expect(text('1 line of 120 found for “5:00”')).toExist(),
      expect(role('link', { name: /^Line 101/ })).toExist(),
    )
  })

  test('deletes the clip only once confirmed, naming what goes with it', () => {
    scene(
      { update, view },
      given(onLevel()),
      pointerFollowed,
      click(role('button', { name: 'Delete this clip' })),
      ...dialogShown,
      expect(role('heading', { name: 'Delete reading.mp3?' })).toExist(),
      expect(
        text(
          'The clip, its 3 lines, their curves and every take of them will be deleted from this device. This cannot be undone.',
        ),
      ).toExist(),
      click(role('button', { name: 'Delete the clip' })),
      Command.expectExact(DeleteClip({ clipId: 'c1', name: 'reading.mp3' })),
      expect(role('button', { name: 'Deleting…' })).toBeDisabled(),
      Command.resolve(
        DeleteClip,
        Message.FailedDeleteClip({ clipId: 'c1', reason: 'The disk is busy.' }),
      ),
      expect(text('Nothing was deleted. The disk is busy.')).toExist(),
    )
  })

  test('says when there is no such clip', () => {
    scene(
      { update, view },
      given({
        ...initialModel(
          AppRoute.Level({ clipId: 'gone', maybeFind: Option.none() }),
        ),
        level: LevelPage.Missing({ clipId: 'gone' }),
      }),
      expect(role('heading', { name: 'No such clip', level: 1 })).toExist(),
    )
  })
})

describe('the home screen’s clips', () => {
  test('lists the learner’s clips, each opening its lines, and offers to bring another', () => {
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.Home({ maybeFind: Option.none() })),
        clips: ClipsPage.Ready({
          clips: [
            {
              id: 'c2',
              name: 'news.m4a',
              seconds: 130,
              lines: 41,
              hasAudio: true,
              isPack: false,
            },
            {
              id: 'c1',
              name: 'reading.mp3',
              seconds: 9.5,
              lines: 3,
              hasAudio: false,
              isPack: false,
            },
          ],
        }),
      }),
      expect(role('heading', { name: 'Your own clips', level: 2 })).toExist(),
      expect(
        role('link', { name: /^news\.m4a, 41 lines · 2:10 long/ }),
      ).toHaveAttr('href', '/level/c2'),
      expect(
        role('link', {
          name: /^reading\.mp3, 3 lines · 9\.5 s long · audio not on this device/,
        }),
      ).toExist(),
      expect(role('link', { name: 'Bring your own audio' })).toHaveAttr(
        'href',
        '/upload',
      ),
    )
  })

  test('with none yet, says what bringing one does', () => {
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.Home({ maybeFind: Option.none() })),
        clips: ClipsPage.Ready({ clips: [] }),
      }),
      expect(
        text('Bring a recording of Japanese speech, and copy it line by line.'),
      ).toExist(),
    )
  })
})

describe('a long clip’s heading', () => {
  test('says its length as on a clock', () => {
    scene(
      { update, view },
      given(onLevel(sampleClip(200))),
      pointerFollowed,
      expect(
        text('200 lines from 10:01 of audio, kept on this device.'),
      ).toExist(),
    )
  })
})
