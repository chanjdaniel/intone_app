import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import type { TextChoice } from '../../services/history-records'
import { initialEditor } from '../level/editor'
import {
  DeleteState,
  type LevelClip,
  LevelPage,
  LevelStars,
  levelRowsPerPage,
} from '../level/level'
import { sampleClip } from '../level/testClips'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { LoadSettings } from '../settings/commands'
import { OpenLevel } from '../upload/commands'
import { UploadJob, UploadStep } from '../upload/upload'
import { FocusLineText, SetLineTexts, SetTextChoice } from './commands'
import { textJobOf } from './subscriptions'
import {
  LineTextEdit,
  TextChoiceState,
  TextFormStatus,
  TextJob,
  TextOffer,
  TextPurpose,
  TextStep,
  lineTextFieldId,
  pastedLines,
  pastedTextFieldId,
} from './text'

// The text's rules, through `update`: nothing downloads before the
// learner agrees to the size they see; "Not now" is kept, so a new
// upload does not ask again, and the settings offer it again; an agreed
// model writes later clips out at once; the job runs in the background
// and a result for a job stopped changes nothing; the learner's own text
// is kept line by line, or pasted one line of text for each line.

const read = (maybeChoice: Option.Option<TextChoice>) =>
  TextChoiceState.Read({ maybeChoice })

const onLevel = (
  clip: LevelClip = sampleClip(3),
  choice = read(Option.none()),
): Model => ({
  ...initialModel(
    AppRoute.Level({ clipId: clip.id, maybeFind: Option.none() }),
  ),
  textChoice: choice,
  level: LevelPage.Ready({
    stars: LevelStars.Ready({ lines: [] }),
    clip,
    shownRows: levelRowsPerPage,
    deleting: DeleteState.Idle(),
    editor: initialEditor(clip),
  }),
})

const uploading = (choice: TextChoiceState): Model => {
  const start = initialModel(AppRoute.Upload())
  return {
    ...start,
    textChoice: choice,
    upload: {
      ...start.upload,
      jobsStarted: 1,
      job: UploadJob.Working({
        jobNumber: 1,
        file: new File([new Uint8Array(8)], 'reading.mp3'),
        step: UploadStep.Keeping(),
      }),
    },
  }
}

const shown = Command.resolve(
  Dialog.ShowDialog,
  Dialog.Message.SucceededShowDialog(),
)
const closed = Command.resolve(
  Dialog.CloseDialog,
  Dialog.Message.CompletedCloseDialog(),
)

const transcribing = (clipId = 'c1') => TextPurpose.Transcribe({ clipId })

describe('the download’s consent', () => {
  test('an upload’s level offers the download as it opens, and nothing downloads until the learner agrees', () => {
    story(
      update,
      given(uploading(read(Option.none()))),
      message(Message.SucceededUpload({ jobNumber: 1, clipId: 'c1' })),
      shown,
      Command.resolve(OpenLevel, Message.CompletedOpenLevel()),
      model(current => {
        expect(current.textDialog.isOpen).toBe(true)
        expect(current.textOffer).toStrictEqual(
          TextOffer.Open({ purpose: transcribing(), model: 'whisper-base' }),
        )
        expect(current.textJob).toStrictEqual(TextJob.Idle())
        expect(textJobOf(current)).toStrictEqual(Option.none())
      }),
      message(Message.SelectedTextModel({ model: 'whisper-small' })),
      message(Message.SubmittedTextDownload()),
      Command.expectHas(
        SetTextChoice({ choice: { _tag: 'Agreed', model: 'whisper-small' } }),
      ),
      Command.resolve(SetTextChoice, Message.SucceededSetTextChoice()),
      closed,
      model(current => {
        expect(current.textDialog.isOpen).toBe(false)
        expect(current.textJob).toStrictEqual(
          TextJob.Working({
            jobNumber: 1,
            purpose: transcribing(),
            model: 'whisper-small',
            step: TextStep.Decoding(),
          }),
        )
        expect(textJobOf(current)).toStrictEqual(
          Option.some({
            jobNumber: 1,
            purpose: transcribing(),
            model: 'whisper-small',
          }),
        )
      }),
    )
  })

  test('“Not now” is kept, downloads nothing, and the next upload does not ask again', () => {
    story(
      update,
      given(uploading(read(Option.none()))),
      message(Message.SucceededUpload({ jobNumber: 1, clipId: 'c1' })),
      shown,
      Command.resolve(OpenLevel, Message.CompletedOpenLevel()),
      message(Message.ClickedNotNowText()),
      Command.expectHas(SetTextChoice({ choice: { _tag: 'Declined' } })),
      Command.resolve(SetTextChoice, Message.SucceededSetTextChoice()),
      closed,
      model(current => {
        expect(current.textJob).toStrictEqual(TextJob.Idle())
        expect(current.textChoice).toStrictEqual(
          read(Option.some({ _tag: 'Declined' })),
        )
      }),
    )
    story(
      update,
      given(uploading(read(Option.some({ _tag: 'Declined' })))),
      message(Message.SucceededUpload({ jobNumber: 1, clipId: 'c2' })),
      Command.expectExact(OpenLevel({ clipId: 'c2' })),
      Command.resolve(OpenLevel, Message.CompletedOpenLevel()),
      model(current => {
        expect(current.textDialog.isOpen).toBe(false)
        expect(current.textJob).toStrictEqual(TextJob.Idle())
      }),
    )
  })

  test('the settings offer the download again, for the model alone', () => {
    story(
      update,
      given({
        ...initialModel(AppRoute.Settings()),
        textChoice: read(Option.some({ _tag: 'Declined' })),
      }),
      message(Message.ClickedChooseTextModel()),
      shown,
      model(current =>
        expect(current.textOffer).toStrictEqual(
          TextOffer.Open({
            purpose: TextPurpose.Download(),
            model: 'whisper-base',
          }),
        ),
      ),
      message(Message.SubmittedTextDownload()),
      Command.resolve(SetTextChoice, Message.SucceededSetTextChoice()),
      closed,
      model(current =>
        expect(current.textJob).toMatchObject({
          _tag: 'Working',
          purpose: TextPurpose.Download(),
          model: 'whisper-base',
        }),
      ),
    )
  })

  test('once agreed, a new upload is written out at once, with no dialog', () => {
    story(
      update,
      given(
        uploading(read(Option.some({ _tag: 'Agreed', model: 'whisper-base' }))),
      ),
      message(Message.SucceededUpload({ jobNumber: 1, clipId: 'c1' })),
      Command.expectExact(OpenLevel({ clipId: 'c1' })),
      Command.resolve(OpenLevel, Message.CompletedOpenLevel()),
      model(current => {
        expect(current.textDialog.isOpen).toBe(false)
        expect(current.textJob).toMatchObject({
          _tag: 'Working',
          purpose: transcribing(),
          model: 'whisper-base',
        })
      }),
    )
  })

  test('an answer not yet read offers nothing and starts nothing', () => {
    story(
      update,
      given(uploading(TextChoiceState.NotRead())),
      message(Message.SucceededUpload({ jobNumber: 1, clipId: 'c1' })),
      Command.expectExact(OpenLevel({ clipId: 'c1' })),
      Command.resolve(OpenLevel, Message.CompletedOpenLevel()),
      model(current => {
        expect(current.textDialog.isOpen).toBe(false)
        expect(current.textJob).toStrictEqual(TextJob.Idle())
      }),
    )
  })
})

describe('the job in the background', () => {
  const working = (): Model => ({
    ...onLevel(
      sampleClip(3),
      read(Option.some({ _tag: 'Agreed', model: 'whisper-base' })),
    ),
    textJobsStarted: 1,
    textJob: TextJob.Working({
      jobNumber: 1,
      purpose: transcribing(),
      model: 'whisper-base',
      step: TextStep.Decoding(),
    }),
  })

  test('follows each step, and puts the kept text on the open level’s lines', () => {
    const written: LevelClip = {
      ...sampleClip(3),
      lines: sampleClip(3).lines.map((line, k) => ({
        ...line,
        maybeText: Option.some(['昔は', '中山', '小さなお城'][k] ?? ''),
      })),
      maybeWrittenBy: Option.some('whisper-base'),
    }
    story(
      update,
      given(working()),
      message(
        Message.ProgressedTextJob({
          jobNumber: 1,
          step: TextStep.Downloading({ done: 10, total: 75 }),
        }),
      ),
      model(current =>
        expect(current.textJob).toMatchObject({
          step: TextStep.Downloading({ done: 10, total: 75 }),
        }),
      ),
      message(
        Message.SucceededTextJob({
          jobNumber: 1,
          maybeClip: Option.some(written),
        }),
      ),
      model(current => {
        expect(current.textJob).toStrictEqual(
          TextJob.Done({ purpose: transcribing(), model: 'whisper-base' }),
        )
        expect(current.level).toMatchObject({ clip: written })
      }),
    )
  })

  test('a written-out clip for a level not open changes no level', () => {
    const other: LevelClip = { ...sampleClip(2), id: 'c9' }
    story(
      update,
      given(working()),
      message(
        Message.SucceededTextJob({
          jobNumber: 1,
          maybeClip: Option.some(other),
        }),
      ),
      model(current =>
        expect(current.level).toMatchObject({ clip: sampleClip(3) }),
      ),
    )
  })

  test('Stop ends the job, so its Stream ends, and a late result of it changes nothing', () => {
    story(
      update,
      given(working()),
      message(Message.ClickedStopTextJob()),
      model(current => {
        expect(current.textJob).toStrictEqual(TextJob.Idle())
        expect(textJobOf(current)).toStrictEqual(Option.none())
      }),
      message(
        Message.SucceededTextJob({ jobNumber: 1, maybeClip: Option.none() }),
      ),
      message(Message.FailedTextJob({ jobNumber: 1, reason: 'late' })),
      model(current => expect(current.textJob).toStrictEqual(TextJob.Idle())),
    )
  })

  test('a failure says why, and the level can write it out again', () => {
    story(
      update,
      given(working()),
      message(Message.FailedTextJob({ jobNumber: 1, reason: 'out of memory' })),
      model(current =>
        expect(current.textJob).toStrictEqual(
          TextJob.Failed({
            purpose: transcribing(),
            model: 'whisper-base',
            reason: 'out of memory',
          }),
        ),
      ),
      message(Message.ClickedWriteOutText()),
      model(current =>
        expect(current.textJob).toMatchObject({
          _tag: 'Working',
          jobNumber: 2,
        }),
      ),
    )
  })

  test('a second job never starts while one runs', () => {
    story(
      update,
      given(working()),
      message(Message.ClickedWriteOutText()),
      message(Message.ClickedChooseTextModel()),
      model(current => {
        expect(current.textJob).toMatchObject({ jobNumber: 1 })
        expect(current.textDialog.isOpen).toBe(false)
      }),
    )
  })

  test('clearing all data forgets the answer and stops the job', () => {
    story(
      update,
      given(working()),
      message(Message.SucceededClearAllData()),
      Command.resolve(LoadSettings, Message.FailedLoadSettings({ reason: '' })),
      model(current => {
        expect(current.textJob).toStrictEqual(TextJob.Idle())
        expect(current.textChoice).toStrictEqual(read(Option.none()))
      }),
    )
  })
})

describe('the learner’s own text', () => {
  test('a line’s text is typed under its row and kept for that line alone', () => {
    const kept: LevelClip = {
      ...sampleClip(3),
      lines: sampleClip(3).lines.map(line =>
        line.id === '2'
          ? { ...line, maybeText: Option.some('雨が好き') }
          : line,
      ),
    }
    story(
      update,
      given(onLevel()),
      message(Message.ClickedEditLineText({ lineId: '2' })),
      Command.expectExact(FocusLineText({ id: lineTextFieldId })),
      Command.resolve(FocusLineText, Message.CompletedFocusLineText()),
      model(current =>
        expect(current.lineText).toStrictEqual(
          LineTextEdit.OneLine({
            clipId: 'c1',
            lineId: '2',
            draft: '',
            status: TextFormStatus.Open(),
          }),
        ),
      ),
      message(Message.ChangedTextDraft({ text: ' 雨が好き ' })),
      message(Message.SubmittedLineText()),
      Command.expectExact(
        SetLineTexts({
          clipId: 'c1',
          texts: [{ lineId: '2', text: '雨が好き' }],
        }),
      ),
      model(current =>
        expect(current.lineText).toMatchObject({
          status: TextFormStatus.Saving(),
        }),
      ),
      Command.resolve(
        SetLineTexts,
        Message.SucceededSetLineTexts({ clipId: 'c1', clip: kept }),
      ),
      model(current => {
        expect(current.lineText).toStrictEqual(LineTextEdit.Idle())
        expect(current.level).toMatchObject({ clip: kept })
      }),
    )
  })

  test('a pasted text needs one line of text for each line, and says so', () => {
    story(
      update,
      given(onLevel()),
      message(Message.ClickedPasteText()),
      Command.expectExact(FocusLineText({ id: pastedTextFieldId })),
      Command.resolve(FocusLineText, Message.CompletedFocusLineText()),
      message(Message.ChangedTextDraft({ text: '昔は\n中山' })),
      message(Message.SubmittedLineText()),
      model(current =>
        expect(current.lineText).toMatchObject({
          status: TextFormStatus.Refused({
            reason:
              'That is 2 lines of text, and the clip has 3 lines. Give one line of text for each, in order.',
          }),
        }),
      ),
      message(Message.ChangedTextDraft({ text: '\n昔は\n\n小さなお城\n\n' })),
      message(Message.SubmittedLineText()),
      Command.expectExact(
        SetLineTexts({
          clipId: 'c1',
          texts: [
            { lineId: '1', text: '昔は' },
            { lineId: '2', text: '' },
            { lineId: '3', text: '小さなお城' },
          ],
        }),
      ),
      Command.resolve(
        SetLineTexts,
        Message.SucceededSetLineTexts({ clipId: 'c1', clip: sampleClip(3) }),
      ),
    )
  })

  test('a text that was not kept says why, and keeps what was typed', () => {
    story(
      update,
      given(onLevel()),
      message(Message.ClickedEditLineText({ lineId: '1' })),
      Command.resolve(FocusLineText, Message.CompletedFocusLineText()),
      message(Message.ChangedTextDraft({ text: '昔は' })),
      message(Message.SubmittedLineText()),
      Command.resolve(
        SetLineTexts,
        Message.FailedSetLineTexts({
          clipId: 'c1',
          reason: 'The text was not kept. The disk is full.',
        }),
      ),
      model(current =>
        expect(current.lineText).toMatchObject({
          draft: '昔は',
          status: TextFormStatus.Refused({
            reason: 'The text was not kept. The disk is full.',
          }),
        }),
      ),
      message(Message.ClickedCancelLineText()),
      model(current =>
        expect(current.lineText).toStrictEqual(LineTextEdit.Idle()),
      ),
    )
  })

  test('counts the pasted lines between the first and the last with text', () => {
    expect(pastedLines('\n\n a \r\n\n b\n\n')).toStrictEqual(['a', '', 'b'])
    expect(pastedLines(' \n ')).toStrictEqual([])
  })
})
