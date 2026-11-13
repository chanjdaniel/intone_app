import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { TextChoice, TextModelId } from '../../services/history-records'

// The text of the learner's clips, in the Model: what they said to the
// text model's download, the consent dialog's choice, the one job that
// downloads the model or writes a clip's text out in the background, and
// a line's or a whole clip's text as the learner types or pastes it.
// Practice never waits on any of it, and no score reads the text.

// What the learner said to the download, read from the device once, when
// the app opens.
export const TextChoiceState = defineTaggedUnion({
  NotRead: {},
  Read: { maybeChoice: Schema.Option(TextChoice) },
})
export type TextChoiceState = typeof TextChoiceState.Type

// What a job is for: the model alone, from the settings, or a clip's
// text.
export const TextPurpose = defineTaggedUnion({
  Download: {},
  Transcribe: { clipId: Schema.String },
})
export type TextPurpose = typeof TextPurpose.Type

export const TextStep = defineTaggedUnion({
  Decoding: {},
  // Bytes of the model on the device, of all it takes.
  Downloading: { done: Schema.Finite, total: Schema.Finite },
  Preparing: {},
  // Windows of the clip read, of all of them.
  Transcribing: { done: Schema.Finite, total: Schema.Finite },
  Keeping: {},
})
export type TextStep = typeof TextStep.Type

export const TextJob = defineTaggedUnion({
  Idle: {},
  Working: {
    jobNumber: Schema.Finite,
    purpose: TextPurpose,
    model: TextModelId,
    step: TextStep,
  },
  Done: { purpose: TextPurpose, model: TextModelId },
  Failed: { purpose: TextPurpose, model: TextModelId, reason: Schema.String },
})
export type TextJob = typeof TextJob.Type

// The consent dialog's contents while it is open: what agreeing starts,
// and the model chosen.
export const TextOffer = defineTaggedUnion({
  Closed: {},
  Open: { purpose: TextPurpose, model: TextModelId },
})
export type TextOffer = typeof TextOffer.Type

export const TextFormStatus = defineTaggedUnion({
  Open: {},
  Saving: {},
  Refused: { reason: Schema.String },
})
export type TextFormStatus = typeof TextFormStatus.Type

// The learner's own text, as they type it: one line's, or the whole
// clip's pasted, one line of text for each of its lines.
export const LineTextEdit = defineTaggedUnion({
  Idle: {},
  OneLine: {
    clipId: Schema.String,
    lineId: Schema.String,
    draft: Schema.String,
    status: TextFormStatus,
  },
  WholeClip: {
    clipId: Schema.String,
    draft: Schema.String,
    status: TextFormStatus,
  },
})
export type LineTextEdit = typeof LineTextEdit.Type

export const textDialogId = 'text-model-dialog'
export const lineTextFieldId = 'line-text-field'
export const pastedTextFieldId = 'pasted-text-field'

// A pasted text's lines, one for each of the clip's lines: blank lines
// before and after it are not counted, and each line is trimmed.
export const pastedLines = (draft: string): ReadonlyArray<string> => {
  const lines = draft.split(/\r?\n/).map(line => line.trim())
  const first = lines.findIndex(line => line !== '')
  const last =
    lines.length - 1 - [...lines].reverse().findIndex(line => line !== '')
  return first === -1 ? [] : lines.slice(first, last + 1)
}
