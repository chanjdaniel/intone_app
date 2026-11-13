import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog } from '@foldkit/ui'

import type { TextChoice, TextModelId } from '../../services/history-records'
import type { LevelClip } from '../level/level'
import { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import { FocusLineText, SetLineTexts, SetTextChoice } from './commands'
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

// The text's transitions. The download is offered in a dialog that names
// its size; agreeing starts the one job in the background and keeps the
// answer, so a later clip is written out without asking again, and "Not
// now" keeps that too, so a new upload does not ask again: the settings
// offer the download again. A job runs whatever screen is open, and a
// result for a job no longer running changes nothing.

type TextUpdate = Update.Return<Model, Message, AppResourceServices>

const unchanged = (model: Model): TextUpdate => ({ model })

type ReadyLevel = Extract<Model['level'], { _tag: 'Ready' }>

const agreedModel = (model: Model): Option.Option<TextModelId> =>
  model.textChoice._tag === 'Read'
    ? Option.flatMap(model.textChoice.maybeChoice, choice =>
        choice._tag === 'Agreed' ? Option.some(choice.model) : Option.none(),
      )
    : Option.none()

// The agreed model, when its files are all on this device, so a job with
// it downloads nothing; an agreed model not here is offered again, with
// its size, before anything downloads.
const keptModel = (model: Model): Option.Option<TextModelId> =>
  model.textChoice._tag === 'Read' && model.textChoice.modelKept
    ? agreedModel(model)
    : Option.none()

const isDeclined = (model: Model): boolean =>
  model.textChoice._tag === 'Read' &&
  Option.exists(
    model.textChoice.maybeChoice,
    choice => choice._tag === 'Declined',
  )

const isWorking = (model: Model, jobNumber: number): boolean =>
  model.textJob._tag === 'Working' && model.textJob.jobNumber === jobNumber

// The model is not on the device until a job has fetched it.
const withChoice = (model: Model, choice: TextChoice): Model =>
  modifyFields(model, {
    textChoice: () =>
      TextChoiceState.Read({
        maybeChoice: Option.some(choice),
        modelKept: false,
      }),
  })

const startedJob = (
  model: Model,
  purpose: TextPurpose,
  textModel: TextModelId,
): Model =>
  modifyFields(model, {
    textJobsStarted: started => started + 1,
    textJob: () =>
      TextJob.Working({
        jobNumber: model.textJobsStarted + 1,
        purpose,
        model: textModel,
        step:
          purpose._tag === 'Download'
            ? TextStep.Downloading({ done: 0, total: 1 })
            : TextStep.Decoding(),
      }),
  })

export const succeededLoadTextChoice = (
  model: Model,
  maybeChoice: Option.Option<TextChoice>,
  modelKept: boolean,
): TextUpdate => ({
  model: modifyFields(model, {
    textChoice: () => TextChoiceState.Read({ maybeChoice, modelKept }),
  }),
})

// An answer that could not be read is taken as none: the learner is
// asked, and nothing downloads unasked.
export const failedLoadTextChoice = (model: Model): TextUpdate => ({
  model: modifyFields(model, {
    textChoice: () =>
      TextChoiceState.Read({ maybeChoice: Option.none(), modelKept: false }),
  }),
})

// THE DIALOG

const foldTextDialogOutMessage = Dialog.OutMessage.match<
  Update.Step<Model, Message>
>({
  Opened: () => model => ({ model }),
  Closed: () => model => ({
    model: modifyFields(model, { textOffer: () => TextOffer.Closed() }),
  }),
})

const dialogFields = {
  read: (model: Model) => Option.some(model.textDialog),
  write: (model: Model, nextTextDialog: Dialog.Model) =>
    modifyFields(model, { textDialog: () => nextTextDialog }),
  toParentMessage: (message: Dialog.Message) =>
    Message.GotTextDialogMessage({ message }),
  foldOutMessage: foldTextDialogOutMessage,
}

export const foldTextDialog = Update.foldChild({
  update: Dialog.update,
  ...dialogFields,
})

const foldTextDialogOpen = Update.foldChildStep({
  update: Dialog.open,
  ...dialogFields,
})

const foldTextDialogClose = Update.foldChildStep({
  update: Dialog.close,
  ...dialogFields,
})

// Offers the download for `purpose`, the model agreed before chosen, or
// whisper-base.
const offered = (model: Model, purpose: TextPurpose): TextUpdate =>
  foldTextDialogOpen(
    modifyFields(model, {
      textOffer: () =>
        TextOffer.Open({
          purpose,
          model: Option.getOrElse(agreedModel(model), () => 'whisper-base'),
        }),
    }),
  )

// A clip's level asks for its text: written out at once with the model
// agreed to when it is on this device, else the download is offered.
export const clickedWriteOutText = (model: Model): TextUpdate => {
  const page = model.level
  if (page._tag !== 'Ready' || model.textJob._tag === 'Working') {
    return unchanged(model)
  }
  const purpose = TextPurpose.Transcribe({ clipId: page.clip.id })
  return Option.match(keptModel(model), {
    onNone: () => offered(model, purpose),
    onSome: textModel => ({ model: startedJob(model, purpose, textModel) }),
  })
}

// An upload's level has just opened: its text is written out with the
// model agreed to when it is on this device, or the download offered,
// unless the learner said not now, or a job is running.
export const offeredUploadText = (model: Model, clipId: string): TextUpdate => {
  if (model.textJob._tag === 'Working' || isDeclined(model)) {
    return unchanged(model)
  }
  const purpose = TextPurpose.Transcribe({ clipId })
  return Option.match(keptModel(model), {
    onNone: () =>
      model.textChoice._tag === 'Read'
        ? offered(model, purpose)
        : unchanged(model),
    onSome: textModel => ({ model: startedJob(model, purpose, textModel) }),
  })
}

// The settings offer the download again, or another model.
export const clickedChooseTextModel = (model: Model): TextUpdate =>
  model.textJob._tag === 'Working'
    ? unchanged(model)
    : offered(model, TextPurpose.Download())

export const selectedTextModel = (
  model: Model,
  textModel: TextModelId,
): TextUpdate => ({
  model: modifyFields(model, {
    textOffer: offer =>
      offer._tag === 'Open'
        ? modifyFields(offer, { model: () => textModel })
        : offer,
  }),
})

export const submittedTextDownload = (model: Model): TextUpdate => {
  const offer = model.textOffer
  if (offer._tag !== 'Open' || model.textJob._tag === 'Working') {
    return foldTextDialogClose(model)
  }
  const choice: TextChoice = { _tag: 'Agreed', model: offer.model }
  return Update.combine(model, [
    stepModel => ({
      model: startedJob(
        withChoice(stepModel, choice),
        offer.purpose,
        offer.model,
      ),
      commands: [SetTextChoice({ choice })],
    }),
    foldTextDialogClose,
  ])
}

export const clickedNotNowText = (model: Model): TextUpdate => {
  const choice: TextChoice = { _tag: 'Declined' }
  return Update.combine(model, [
    stepModel => ({
      model: withChoice(stepModel, choice),
      commands: [SetTextChoice({ choice })],
    }),
    foldTextDialogClose,
  ])
}

// THE JOB

export const progressedTextJob = (
  model: Model,
  jobNumber: number,
  step: TextStep,
): TextUpdate =>
  isWorking(model, jobNumber)
    ? {
        model: modifyFields(model, {
          textJob: job =>
            job._tag === 'Working'
              ? modifyFields(job, { step: () => step })
              : job,
        }),
      }
    : unchanged(model)

// The clip's text kept, its level, if open, shows it.
export const succeededTextJob = (
  model: Model,
  jobNumber: number,
  maybeClip: Option.Option<LevelClip>,
): TextUpdate => {
  const job = model.textJob
  if (job._tag !== 'Working' || job.jobNumber !== jobNumber) {
    return unchanged(model)
  }
  return {
    model: modifyFields(model, {
      textJob: () => TextJob.Done({ purpose: job.purpose, model: job.model }),
      // The job fetched its model's files, if they were not here.
      textChoice: choice =>
        choice._tag === 'Read' &&
        Option.exists(
          choice.maybeChoice,
          answer => answer._tag === 'Agreed' && answer.model === job.model,
        )
          ? modifyFields(choice, { modelKept: () => true })
          : choice,
      level: page =>
        Option.match(maybeClip, {
          onNone: () => page,
          onSome: clip =>
            page._tag === 'Ready' && page.clip.id === clip.id
              ? modifyFields(page, { clip: () => clip })
              : page,
        }),
    }),
  }
}

export const failedTextJob = (
  model: Model,
  jobNumber: number,
  reason: string,
): TextUpdate => {
  const job = model.textJob
  return job._tag === 'Working' && job.jobNumber === jobNumber
    ? {
        model: modifyFields(model, {
          textJob: () =>
            TextJob.Failed({ purpose: job.purpose, model: job.model, reason }),
        }),
      }
    : unchanged(model)
}

// Stopping ends the job's Stream, which closes the text Worker.
export const clickedStopTextJob = (model: Model): TextUpdate =>
  model.textJob._tag === 'Working'
    ? { model: modifyFields(model, { textJob: () => TextJob.Idle() }) }
    : unchanged(model)

// THE LEARNER'S OWN TEXT

const readyLevel = (model: Model): Option.Option<ReadyLevel> =>
  model.level._tag === 'Ready' ? Option.some(model.level) : Option.none()

export const clickedEditLineText = (model: Model, lineId: string): TextUpdate =>
  Option.match(
    Option.flatMap(readyLevel(model), page =>
      Option.map(
        Option.fromNullishOr(page.clip.lines.find(line => line.id === lineId)),
        line => ({ clipId: page.clip.id, line }),
      ),
    ),
    {
      onNone: () => unchanged(model),
      onSome: ({ clipId, line }) => ({
        model: modifyFields(model, {
          lineText: () =>
            LineTextEdit.OneLine({
              clipId,
              lineId,
              draft: Option.getOrElse(line.maybeText, () => ''),
              status: TextFormStatus.Open(),
            }),
        }),
        commands: [FocusLineText({ id: lineTextFieldId })],
      }),
    },
  )

// The whole clip's text to paste over, given as it is now, one line of
// text for each line.
export const clickedPasteText = (model: Model): TextUpdate =>
  Option.match(readyLevel(model), {
    onNone: () => unchanged(model),
    onSome: page => ({
      model: modifyFields(model, {
        lineText: () =>
          LineTextEdit.WholeClip({
            clipId: page.clip.id,
            draft: page.clip.lines
              .map(line => Option.getOrElse(line.maybeText, () => ''))
              .join('\n'),
            status: TextFormStatus.Open(),
          }),
      }),
      commands: [FocusLineText({ id: pastedTextFieldId })],
    }),
  })

export const changedTextDraft = (model: Model, text: string): TextUpdate => ({
  model: modifyFields(model, {
    lineText: edit =>
      LineTextEdit.match(edit, {
        Idle: () => edit,
        OneLine: one =>
          modifyFields(one, {
            draft: () => text,
            status: status =>
              status._tag === 'Saving' ? status : TextFormStatus.Open(),
          }),
        WholeClip: whole =>
          modifyFields(whole, {
            draft: () => text,
            status: status =>
              status._tag === 'Saving' ? status : TextFormStatus.Open(),
          }),
      }),
  }),
})

const saving = (
  model: Model,
  clipId: string,
  texts: ReadonlyArray<Readonly<{ lineId: string; text: string }>>,
): TextUpdate => ({
  model: modifyFields(model, {
    lineText: edit =>
      edit._tag === 'Idle'
        ? edit
        : modifyFields(edit, { status: () => TextFormStatus.Saving() }),
  }),
  commands: [SetLineTexts({ clipId, texts })],
})

const refused = (model: Model, reason: string): TextUpdate => ({
  model: modifyFields(model, {
    lineText: edit =>
      edit._tag === 'Idle'
        ? edit
        : modifyFields(edit, {
            status: () => TextFormStatus.Refused({ reason }),
          }),
  }),
})

// A pasted text needs one line of text for each of the clip's lines.
export const submittedLineText = (model: Model): TextUpdate => {
  const edit = model.lineText
  const page = model.level
  if (
    edit._tag === 'Idle' ||
    edit.status._tag === 'Saving' ||
    page._tag !== 'Ready' ||
    page.clip.id !== edit.clipId
  ) {
    return unchanged(model)
  }
  if (edit._tag === 'OneLine') {
    return saving(model, edit.clipId, [
      { lineId: edit.lineId, text: edit.draft.trim() },
    ])
  }
  const given = pastedLines(edit.draft)
  const lines = page.clip.lines
  return given.length === lines.length
    ? saving(
        model,
        edit.clipId,
        lines.map((line, k) => ({ lineId: line.id, text: given[k] ?? '' })),
      )
    : refused(
        model,
        `That is ${given.length === 1 ? '1 line' : `${given.length} lines`} of text, and the clip has ${lines.length === 1 ? '1 line' : `${lines.length} lines`}. Give one line of text for each, in order.`,
      )
}

export const clickedCancelLineText = (model: Model): TextUpdate => ({
  model: modifyFields(model, { lineText: () => LineTextEdit.Idle() }),
})

export const succeededSetLineTexts = (
  model: Model,
  clipId: string,
  clip: LevelClip,
): TextUpdate => ({
  model: modifyFields(model, {
    lineText: edit =>
      edit._tag !== 'Idle' && edit.clipId === clipId
        ? LineTextEdit.Idle()
        : edit,
    level: page =>
      page._tag === 'Ready' && page.clip.id === clipId
        ? modifyFields(page, { clip: () => clip })
        : page,
  }),
})

export const failedSetLineTexts = (
  model: Model,
  clipId: string,
  reason: string,
): TextUpdate =>
  model.lineText._tag !== 'Idle' && model.lineText.clipId === clipId
    ? refused(model, reason)
    : unchanged(model)

// Everything on the device is gone: the answer with it, and the model's
// files, so a job under way stops.
export const clearedAllData = (model: Model): Model =>
  modifyFields(model, {
    textChoice: () =>
      TextChoiceState.Read({ maybeChoice: Option.none(), modelKept: false }),
    textJob: () => TextJob.Idle(),
    lineText: () => LineTextEdit.Idle(),
  })

// Leaving a level drops what was being typed on it.
export const leftLevel = (model: Model): Model =>
  modifyFields(model, { lineText: () => LineTextEdit.Idle() })
