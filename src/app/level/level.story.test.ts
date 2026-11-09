import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { LoadHistory } from '../history/commands'
import { NativeCurve } from '../line/native'
import {
  AppRoute,
  Message,
  type Model,
  init,
  initialModel,
  update,
} from '../main'
import {
  DeleteClip,
  FocusLevelRow,
  GoHome,
  LoadClips,
  LoadLevel,
  ReplaceLevelFind,
} from './commands'
import { initialEditor } from './editor'
import { ClipsPage, DeleteState, LevelPage, levelRowsPerPage } from './level'
import { sampleClip } from './testClips'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const onLevel = (clip = sampleClip(120)): Model => ({
  ...initialModel(
    AppRoute.Level({ clipId: clip.id, maybeFind: Option.none() }),
  ),
  level: LevelPage.Ready({
    clip,
    shownRows: levelRowsPerPage,
    deleting: DeleteState.Idle(),
    editor: initialEditor(clip),
  }),
})

describe('a clip’s lines', () => {
  test('are read from the device when the level opens', () => {
    const start = init(url('/level/c1'))
    expect(start.model.level).toStrictEqual(LevelPage.Loading({ clipId: 'c1' }))
    expect(start.commands).toMatchObject([
      { name: LoadLevel.name, args: { clipId: 'c1' } },
    ])
  })

  test('show the clip once read, or say there is none', () => {
    const clip = sampleClip(3)
    story(
      update,
      given({
        ...initialModel(
          AppRoute.Level({ clipId: 'c1', maybeFind: Option.none() }),
        ),
        level: LevelPage.Loading({ clipId: 'c1' }),
      }),
      message(
        Message.SucceededLoadLevel({
          clipId: 'other',
          maybeClip: Option.some(clip),
        }),
      ),
      model(current => expect(current.level._tag).toBe('Loading')),
      message(
        Message.SucceededLoadLevel({
          clipId: 'c1',
          maybeClip: Option.some(clip),
        }),
      ),
      model(current =>
        expect(current.level).toStrictEqual(
          LevelPage.Ready({
            clip,
            shownRows: levelRowsPerPage,
            deleting: DeleteState.Idle(),
            editor: initialEditor(clip),
          }),
        ),
      ),
    )
    story(
      update,
      given({
        ...initialModel(
          AppRoute.Level({ clipId: 'c1', maybeFind: Option.none() }),
        ),
        level: LevelPage.Loading({ clipId: 'c1' }),
      }),
      message(
        Message.SucceededLoadLevel({ clipId: 'c1', maybeClip: Option.none() }),
      ),
      model(current =>
        expect(current.level).toStrictEqual(
          LevelPage.Missing({ clipId: 'c1' }),
        ),
      ),
    )
  })

  test('write the find words to the address, and new words show one page again', () => {
    story(
      update,
      given(onLevel()),
      message(Message.ClickedShowMoreLevelLines()),
      Command.expectExact(FocusLevelRow({ index: levelRowsPerPage })),
      Command.resolve(FocusLevelRow, Message.CompletedFocusLevelRow()),
      model(current =>
        expect(current.level).toMatchObject({
          shownRows: 2 * levelRowsPerPage,
        }),
      ),
      message(Message.ChangedFindLevelLines({ words: 'Line 1' })),
      Command.expectExact(ReplaceLevelFind({ clipId: 'c1', words: 'Line 1' })),
      Command.resolve(ReplaceLevelFind, Message.CompletedReplaceLevelFind()),
      message(Message.ChangedUrl({ url: url('/level/c1?find=Line%201') })),
      model(current => {
        expect(current.route).toStrictEqual(
          AppRoute.Level({ clipId: 'c1', maybeFind: Option.some('Line 1') }),
        )
        expect(current.level).toMatchObject({ shownRows: levelRowsPerPage })
      }),
    )
  })
})

describe('deleting a clip', () => {
  test('asks first, then deletes it with everything of it and goes home saying so', () => {
    story(
      update,
      given({
        ...onLevel(),
        clips: ClipsPage.Ready({
          clips: [
            {
              id: 'c1',
              name: 'reading.mp3',
              seconds: 9,
              lines: 3,
              hasAudio: true,
              isPack: false,
            },
            {
              id: 'c2',
              name: 'other.wav',
              seconds: 9,
              lines: 3,
              hasAudio: true,
              isPack: false,
            },
          ],
        }),
        native: NativeCurve.Failed({
          clipId: 'c1',
          lineId: '2',
          failure: 'Failed',
          reason: 'quiet',
        }),
      }),
      message(Message.ClickedDeleteClip()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      model(current => expect(current.deleteClipDialog.isOpen).toBe(true)),
      message(Message.SubmittedDeleteClip()),
      Command.expectExact(DeleteClip({ clipId: 'c1', name: 'reading.mp3' })),
      model(current =>
        expect(current.level).toMatchObject({
          deleting: DeleteState.Deleting(),
        }),
      ),
      Command.resolve(
        DeleteClip,
        Message.SucceededDeleteClip({ clipId: 'c1', name: 'reading.mp3' }),
      ),
      Command.resolve(GoHome, Message.CompletedGoHome()),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      model(current => {
        expect(current.level).toStrictEqual(LevelPage.NotLoaded())
        expect(current.clips).toStrictEqual(
          ClipsPage.Ready({
            clips: [
              {
                id: 'c2',
                name: 'other.wav',
                seconds: 9,
                lines: 3,
                hasAudio: true,
                isPack: false,
              },
            ],
          }),
        )
        expect(current.native).toStrictEqual(NativeCurve.NoLine())
        expect(current.maybeHomeNotice).toStrictEqual(
          Option.some(
            'Deleted reading.mp3, with its lines and your takes of them.',
          ),
        )
      }),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      model(current =>
        expect(Option.isSome(current.maybeHomeNotice)).toBe(true),
      ),
      message(Message.ChangedUrl({ url: url('/history') })),
      Command.resolve(LoadHistory, Message.FailedLoadHistory({ reason: 'x' })),
      model(current =>
        expect(current.maybeHomeNotice).toStrictEqual(Option.none()),
      ),
    )
  })

  test('keeps the clip when the learner changes their mind, or when it could not be deleted', () => {
    story(
      update,
      given(onLevel()),
      message(Message.ClickedDeleteClip()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      message(Message.SubmittedDeleteClip()),
      Command.resolve(
        DeleteClip,
        Message.FailedDeleteClip({ clipId: 'c1', reason: 'The disk is busy.' }),
      ),
      model(current =>
        expect(current.level).toMatchObject({
          deleting: DeleteState.Failed({ reason: 'The disk is busy.' }),
        }),
      ),
      message(Message.ClickedKeepClip()),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      model(current => {
        expect(current.deleteClipDialog.isOpen).toBe(false)
        expect(current.level._tag).toBe('Ready')
      }),
    )
  })
})
