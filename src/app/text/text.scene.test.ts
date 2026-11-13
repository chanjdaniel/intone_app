import { Option } from 'effect'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  label,
  role,
  scene,
  text,
  type,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import type { TextChoice } from '../../services/history-records'
import { textModelBytes } from '../../services/transcriber'
import { initialEditor } from '../level/editor'
import {
  DeleteState,
  type LevelClip,
  LevelPage,
  LevelStars,
  levelRowsPerPage,
} from '../level/level'
import { sampleClip } from '../level/testClips'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { SettingsPage } from '../settings/settings'
import { FocusLineText, SetLineTexts, SetTextChoice } from './commands'
import {
  LineTextEdit,
  TextChoiceState,
  TextFormStatus,
  TextJob,
  TextPurpose,
  TextStep,
} from './text'

// The text on screen: the consent dialog names the download's size, and
// the size follows the model chosen; a level shows the job's progress
// with a Stop, what wrote the text, each line by its text, and the forms
// for a line's own text and for the whole clip's; the settings say what
// the learner answered and offer the download again.

const mb = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`
const baseSize = mb(textModelBytes('whisper-base'))
const smallSize = mb(textModelBytes('whisper-small'))

const read = (maybeChoice: Option.Option<TextChoice>) =>
  TextChoiceState.Read({ maybeChoice, modelKept: true })

const onLevel = (
  clip: LevelClip = sampleClip(3),
  extra: Partial<Model> = {},
): Model => ({
  ...initialModel(
    AppRoute.Level({ clipId: clip.id, maybeFind: Option.none() }),
  ),
  textChoice: read(Option.none()),
  level: LevelPage.Ready({
    stars: LevelStars.Ready({ lines: [] }),
    clip,
    shownRows: levelRowsPerPage,
    deleting: DeleteState.Idle(),
    editor: initialEditor(clip),
  }),
  ...extra,
})

const dialogShown = [
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  Mount.resolve(
    Dialog.AcquireResources,
    Dialog.Message.SucceededAcquireResources(),
  ),
] as const

const written: LevelClip = {
  ...sampleClip(3),
  lines: sampleClip(3).lines.map((line, k) => ({
    ...line,
    maybeText: Option.some(
      ['昔は私たちの村の近くの', '中山というところに', '小さなお城があって'][
        k
      ] ?? '',
    ),
  })),
  maybeWrittenBy: Option.some('whisper-base'),
}

describe('the consent dialog', () => {
  test('names the download’s size before anything downloads, and the size follows the model chosen', () => {
    scene(
      { update, view },
      given(onLevel()),
      expect(
        text(
          'Its lines have no text yet. Intone can write it out on this device, or you can paste your own.',
        ),
      ).toExist(),
      click(role('button', { name: 'Write out the text' })),
      ...dialogShown,
      expect(role('heading', { name: 'Download the text model?' })).toExist(),
      expect(
        text(
          `Intone can write out each line’s text, on this device. It needs a one-time download of ${baseSize}, which the browser keeps. Your clip never leaves this device.`,
        ),
      ).toExist(),
      expect(role('button', { name: `Download ${baseSize}` })).toExist(),
      expect(role('button', { name: 'Not now' })).toExist(),
      click(label(`Larger model, better text (whisper-small, ${smallSize})`)),
      expect(role('button', { name: `Download ${smallSize}` })).toExist(),
      expect(text(new RegExp(`one-time download of ${smallSize}`))).toExist(),
    )
  })

  test('agreeing starts the download in the background, with its progress and a Stop', () => {
    scene(
      { update, view },
      given(onLevel()),
      click(role('button', { name: 'Write out the text' })),
      ...dialogShown,
      click(role('button', { name: `Download ${baseSize}` })),
      Command.resolve(SetTextChoice, Message.SucceededSetTextChoice()),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(role('status')).toHaveText('Reading the clip’s audio.'),
      expect(role('button', { name: 'Stop' })).toExist(),
      expect(role('button', { name: 'Write out the text' })).toBeAbsent(),
      expect(
        text('It runs in the background: practise any line meanwhile.'),
      ).toExist(),
    )
  })
})

describe('a level’s text', () => {
  const working = (step: TextStep) =>
    onLevel(sampleClip(3), {
      textJob: TextJob.Working({
        jobNumber: 1,
        purpose: TextPurpose.Transcribe({ clipId: 'c1' }),
        model: 'whisper-base',
        step,
      }),
    })

  test('shows the download’s bytes, then the parts read, each with its bar', () => {
    scene(
      { update, view },
      given(
        working(TextStep.Downloading({ done: 30_000_000, total: 75_000_000 })),
      ),
      expect(role('status')).toHaveText(
        'Downloading the text model: 30 of 75 MB.',
      ),
      expect(role('progressbar', { name: 'Text written out' })).toHaveAttr(
        'aria-valuenow',
        '40',
      ),
    )
    scene(
      { update, view },
      given(working(TextStep.Transcribing({ done: 1, total: 4 }))),
      expect(role('status')).toHaveText('Writing out the text: part 2 of 4.'),
      expect(role('progressbar', { name: 'Text written out' })).toHaveAttr(
        'aria-valuenow',
        '25',
      ),
    )
  })

  test('a job for another clip shows nothing here', () => {
    scene(
      { update, view },
      given(
        onLevel(sampleClip(3), {
          textJob: TextJob.Working({
            jobNumber: 1,
            purpose: TextPurpose.Transcribe({ clipId: 'c9' }),
            model: 'whisper-base',
            step: TextStep.Preparing(),
          }),
        }),
      ),
      expect(role('button', { name: 'Stop' })).toBeAbsent(),
      expect(role('button', { name: 'Paste your own text' })).toExist(),
    )
  })

  test('a failure is said, with the way to try again', () => {
    scene(
      { update, view },
      given(
        onLevel(sampleClip(3), {
          textJob: TextJob.Failed({
            purpose: TextPurpose.Transcribe({ clipId: 'c1' }),
            model: 'whisper-base',
            reason: 'The text model stopped: out of memory',
          }),
        }),
      ),
      expect(role('alert')).toHaveText(
        'The text was not written out. The text model stopped: out of memory',
      ),
      expect(role('button', { name: 'Write out the text' })).toExist(),
    )
  })

  test('names each line by its text once written out, says what wrote it, and keeps the line’s name and times', () => {
    scene(
      { update, view },
      given(onLevel(written)),
      expect(text(/^Written out on this device by Whisper base\./)).toExist(),
      expect(
        role('link', {
          name: /^昔は私たちの村の近くの, Line 1 · 0:00.4 to 0:02.9/,
        }),
      ).toHaveAttr('href', '/line/c1/1'),
      expect(role('button', { name: 'Write out the text again' })).toExist(),
      expect(role('button', { name: 'Edit line 1’s text' })).toExist(),
    )
  })

  test('a line’s own text is typed under its row, and kept', () => {
    scene(
      { update, view },
      given(onLevel(written)),
      click(role('button', { name: 'Edit line 3’s text' })),
      Command.resolve(FocusLineText, Message.CompletedFocusLineText()),
      expect(label('Line 3’s text')).toHaveValue('小さなお城があって'),
      type(label('Line 3’s text'), 'の小さなお城'),
      click(role('button', { name: 'Keep the text' })),
      expect(role('button', { name: 'Saving…' })).toExist(),
      Command.resolve(
        SetLineTexts,
        Message.SucceededSetLineTexts({
          clipId: 'c1',
          clip: {
            ...written,
            lines: written.lines.map(line =>
              line.id === '3'
                ? { ...line, maybeText: Option.some('小さなお城') }
                : line,
            ),
          },
        }),
      ),
      expect(label('Line 3’s text')).toBeAbsent(),
      expect(role('link', { name: /^小さなお城, Line 3/ })).toExist(),
    )
  })

  test('a whole clip’s text is pasted one line for each line, and a count that differs is refused', () => {
    scene(
      { update, view },
      given(
        onLevel(sampleClip(3), {
          lineText: LineTextEdit.WholeClip({
            clipId: 'c1',
            draft: '昔は\n中山',
            status: TextFormStatus.Refused({
              reason:
                'That is 2 lines of text, and the clip has 3 lines. Give one line of text for each, in order.',
            }),
          }),
        }),
      ),
      expect(
        label('Your text, one line for each of the clip’s 3 lines, in order'),
      ).toHaveValue('昔は\n中山'),
      expect(role('alert')).toHaveText(
        'That is 2 lines of text, and the clip has 3 lines. Give one line of text for each, in order.',
      ),
      expect(role('button', { name: 'Keep this text' })).toExist(),
      expect(role('button', { name: 'Paste your own text' })).toBeAbsent(),
    )
  })

  test('a clip given its own text and never written out says the text is the learner’s, not that it has none', () => {
    scene(
      { update, view },
      given(onLevel({ ...written, maybeWrittenBy: Option.none() })),
      expect(
        text(
          'Its lines have the text you gave them, which stands over anything Intone writes out. Intone can still write it out on this device, or you can paste yours again.',
        ),
      ).toExist(),
      expect(text(/no text yet/)).toBeAbsent(),
      expect(role('button', { name: 'Write out the text' })).toExist(),
    )
  })

  test('a clip whose audio is not here can still be given text, but not written out', () => {
    scene(
      { update, view },
      given(onLevel(sampleClip(3, false))),
      expect(role('button', { name: 'Write out the text' })).toBeAbsent(),
      expect(role('button', { name: 'Paste your own text' })).toExist(),
      click(role('button', { name: 'Paste your own text' })),
      Command.resolve(FocusLineText, Message.CompletedFocusLineText()),
      expect(
        label('Your text, one line for each of the clip’s 3 lines, in order'),
      ).toExist(),
    )
  })
})

describe('the settings’ text model', () => {
  const settingsWith = (
    choice: TextChoiceState,
    job: TextJob = TextJob.Idle(),
  ): Model => ({
    ...initialModel(AppRoute.Settings()),
    settings: SettingsPage.Ready({
      keepTakeAudio: false,
      takes: 0,
      takesWithAudio: 0,
      clipsWithAudio: 0,
      storage: {
        persistence: 'Granted',
        maybeUsageBytes: Option.none(),
        maybeQuotaBytes: Option.none(),
        browser: 'Other',
      },
      maybeKeepAudioFailure: Option.none(),
      includeAudio: false,
      backup: { _tag: 'Idle' },
      restore: { _tag: 'Idle' },
      clearing: { _tag: 'Idle' },
    }),
    textChoice: choice,
    textJob: job,
  })

  test('offers the download again after “Not now”', () => {
    scene(
      { update, view },
      given(settingsWith(read(Option.some({ _tag: 'Declined' })))),
      expect(role('heading', { name: 'Text for your lines' })).toExist(),
      expect(
        text(
          'You said not now to the text model’s download, so your clips are not written out. You can still type or paste their text.',
        ),
      ).toExist(),
      click(role('button', { name: 'Download the text model' })),
      ...dialogShown,
      expect(role('button', { name: `Download ${baseSize}` })).toExist(),
    )
  })

  test('says which model was agreed to and its size, and shows its download', () => {
    scene(
      { update, view },
      given(
        settingsWith(
          read(Option.some({ _tag: 'Agreed', model: 'whisper-small' })),
          TextJob.Working({
            jobNumber: 1,
            purpose: TextPurpose.Download(),
            model: 'whisper-small',
            step: TextStep.Downloading({ done: 0, total: 1 }),
          }),
        ),
      ),
      expect(
        text(
          `Your clips’ text is written out on this device by Whisper small, a ${smallSize} download the browser keeps.`,
        ),
      ).toExist(),
      expect(role('progressbar', { name: 'Text model downloaded' })).toExist(),
      expect(
        role('button', { name: 'Choose another text model' }),
      ).toBeAbsent(),
    )
  })
})
