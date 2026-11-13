import { Effect, Option, Schema } from 'effect'
import { Command, Dom, type Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { hasKanji, isKanaReading } from '../../engine/text/readings'
import { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import { TextFormStatus } from '../text/text'
import {
  LoadReadingsChoice,
  ReadLineReadings,
  SetLineReadings,
  SetReadingsChoice,
} from './commands'
import {
  LineReadingsState,
  type ReadingDraft,
  ReadingFixForm,
  ReadingsChoice,
  type ReadingsShown,
  type ReadingsTarget,
  ReadingsTool,
  type ShownWord,
  isReadingsFor,
  readingFieldId,
  readingsTarget,
  shownWordsOf,
} from './readings'

// A line's readings: the choice to show them, read when a line opens and
// kept when the learner changes it; the Worker's coming and going; the
// open line's words, asked for whenever they are wanted and not in the
// Model (`withReadings`, run after every update, so a line opened, a
// line's text read, the Worker loaded or a correction kept each lead to
// them the same way); and the form that corrects them.

type ReadingsUpdate = Update.Return<Model, Message, AppResourceServices>

export const editReadingsButtonId = 'edit-readings'

export const FocusReadings = Command.define('FocusReadings', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusReadings],
  execute: ({ id }) =>
    Dom.focus(`#${id}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusReadings()),
    ),
})

// The choice is read once, when the first line opens.
export const openedLine = (model: Model): ReadingsUpdate =>
  model.readingsChoice._tag === 'NotRead'
    ? { model, commands: [LoadReadingsChoice()] }
    : { model }

export const loadedChoice = (
  model: Model,
  maybeShown: Option.Option<ReadingsShown>,
): ReadingsUpdate => ({
  model: modifyFields(model, {
    readingsChoice: () => ReadingsChoice.Read({ maybeShown }),
  }),
})

const chose = (model: Model, shown: ReadingsShown): ReadingsUpdate => ({
  model: modifyFields(model, {
    readingsChoice: () =>
      ReadingsChoice.Read({ maybeShown: Option.some(shown) }),
    // Shown again, the Worker is asked for anew.
    readingsTool: tool =>
      tool._tag === 'Failed' ? ReadingsTool.Released() : tool,
  }),
  commands: [SetReadingsChoice({ shown })],
})

export const clickedShow = (model: Model): ReadingsUpdate =>
  chose(model, 'Shown')

export const clickedHide = (model: Model): ReadingsUpdate =>
  chose(model, 'Hidden')

export const acquired = (model: Model): ReadingsUpdate => ({
  model: modifyFields(model, { readingsTool: () => ReadingsTool.Acquired() }),
})

export const released = (model: Model): ReadingsUpdate => ({
  model: modifyFields(model, { readingsTool: () => ReadingsTool.Released() }),
})

export const failedAcquire = (
  model: Model,
  reason: string,
): ReadingsUpdate => ({
  model: modifyFields(model, {
    readingsTool: () => ReadingsTool.Failed({ reason }),
  }),
})

export const readLine = (
  model: Model,
  target: ReadingsTarget,
  words: ReadonlyArray<ShownWord>,
): ReadingsUpdate =>
  model.readings._tag === 'Reading' && isReadingsFor(model.readings, target)
    ? {
        model: modifyFields(model, {
          readings: () => LineReadingsState.Ready({ ...target, words }),
        }),
      }
    : { model }

export const failedReadLine = (
  model: Model,
  target: ReadingsTarget,
  reason: string,
): ReadingsUpdate =>
  model.readings._tag === 'Reading' && isReadingsFor(model.readings, target)
    ? {
        model: modifyFields(model, {
          readings: () => LineReadingsState.Failed({ ...target, reason }),
        }),
      }
    : { model }

export const clickedEdit = (model: Model): ReadingsUpdate => {
  if (model.readings._tag !== 'Ready') {
    return { model }
  }
  const { clipId, lineId, text, words } = model.readings
  // Every word with kanji, its reading or none, which the learner may give.
  const drafts = words.flatMap(word =>
    hasKanji(word.surface)
      ? [
          {
            from: word.from,
            to: word.to,
            surface: word.surface,
            draft: Option.getOrElse(word.maybeKana, () => ''),
            maybeDictionaryKana: word.maybeDictionaryKana,
          },
        ]
      : [],
  )
  const first = drafts[0]
  return {
    model: modifyFields(model, {
      readingFix: () =>
        ReadingFixForm.Open({
          clipId,
          lineId,
          text,
          drafts,
          status: TextFormStatus.Open(),
        }),
    }),
    commands:
      first === undefined
        ? []
        : [FocusReadings({ id: readingFieldId(first.from) })],
  }
}

export const changedDraft = (
  model: Model,
  from: number,
  text: string,
): ReadingsUpdate => {
  const form = model.readingFix
  return form._tag === 'Open'
    ? {
        model: modifyFields(model, {
          readingFix: () =>
            ReadingFixForm.Open({
              ...form,
              drafts: form.drafts.map(draft =>
                draft.from === from ? { ...draft, draft: text } : draft,
              ),
              status: TextFormStatus.Open(),
            }),
        }),
      }
    : { model }
}

// The edits the drafts make: a field left empty, or holding the
// dictionary's reading, makes none.
const fixesOf = (drafts: ReadonlyArray<ReadingDraft>) =>
  drafts.flatMap(draft => {
    const kana = draft.draft.trim()
    return kana === '' ||
      kana === Option.getOrUndefined(draft.maybeDictionaryKana)
      ? []
      : [{ from: draft.from, to: draft.to, kana }]
  })

export const submitted = (model: Model): ReadingsUpdate => {
  const form = model.readingFix
  if (form._tag !== 'Open' || form.status._tag === 'Saving') {
    return { model }
  }
  const unwritten = form.drafts.find(draft => {
    const kana = draft.draft.trim()
    return kana !== '' && !isKanaReading(kana)
  })
  if (unwritten !== undefined) {
    return {
      model: modifyFields(model, {
        readingFix: () =>
          ReadingFixForm.Open({
            ...form,
            status: TextFormStatus.Refused({
              reason: `Write the reading of ${unwritten.surface} in kana, or leave it empty for the dictionary’s.`,
            }),
          }),
      }),
      commands: [FocusReadings({ id: readingFieldId(unwritten.from) })],
    }
  }
  const fixes = fixesOf(form.drafts)
  return {
    model: modifyFields(model, {
      readingFix: () =>
        ReadingFixForm.Open({ ...form, status: TextFormStatus.Saving() }),
    }),
    commands: [
      SetLineReadings({
        clipId: form.clipId,
        lineId: form.lineId,
        text: form.text,
        fixes,
      }),
    ],
  }
}

export const cancelled = (model: Model): ReadingsUpdate => ({
  model: modifyFields(model, { readingFix: () => ReadingFixForm.Closed() }),
  commands: [FocusReadings({ id: editReadingsButtonId })],
})

const isFormFor = (model: Model, clipId: string, lineId: string): boolean =>
  model.readingFix._tag === 'Open' &&
  model.readingFix.clipId === clipId &&
  model.readingFix.lineId === lineId

// Kept: the line's words take the edits at once, the dictionary's reading
// back on a word with none, so the button the focus returns to stays on
// the screen; words not in the Model for that text are read again.
export const keptFixes = (
  model: Model,
  clipId: string,
  lineId: string,
): ReadingsUpdate => {
  const form = model.readingFix
  if (form._tag !== 'Open' || !isFormFor(model, clipId, lineId)) {
    return { model }
  }
  const fixes = fixesOf(form.drafts)
  const current = model.readings
  return {
    model: modifyFields(model, {
      readingFix: () => ReadingFixForm.Closed(),
      readings: () =>
        current._tag === 'Ready' && isReadingsFor(current, form)
          ? LineReadingsState.Ready({
              ...current,
              words: shownWordsOf(
                current.text,
                current.words.map(word => ({
                  from: word.from,
                  to: word.to,
                  surface: word.surface,
                  kana: Option.getOrNull(word.maybeDictionaryKana),
                })),
                Option.some({ text: current.text, fixes }),
              ),
            })
          : LineReadingsState.Idle(),
    }),
    commands: [FocusReadings({ id: editReadingsButtonId })],
  }
}

export const failedKeepFixes = (
  model: Model,
  clipId: string,
  lineId: string,
  reason: string,
): ReadingsUpdate => {
  const form = model.readingFix
  return form._tag === 'Open' && isFormFor(model, clipId, lineId)
    ? {
        model: modifyFields(model, {
          readingFix: () =>
            ReadingFixForm.Open({
              ...form,
              status: TextFormStatus.Refused({ reason }),
            }),
        }),
      }
    : { model }
}

// After every update: the open line's words are asked for once the
// Worker is loaded, unless the Model has them, or is reading them, for
// the line and text open now; with no line to read, they and the form go.
export const withReadings = (result: ReadingsUpdate): ReadingsUpdate => {
  const { model } = result
  const maybeTarget = readingsTarget(model)
  if (Option.isNone(maybeTarget)) {
    return model.readings._tag === 'Idle' && model.readingFix._tag === 'Closed'
      ? result
      : {
          ...result,
          model: modifyFields(model, {
            readings: () => LineReadingsState.Idle(),
            readingFix: () => ReadingFixForm.Closed(),
          }),
        }
  }
  const target = maybeTarget.value
  const current = model.readings
  if (
    model.readingsTool._tag !== 'Acquired' ||
    (current._tag !== 'Idle' && isReadingsFor(current, target))
  ) {
    return result
  }
  return {
    model: modifyFields(model, {
      readings: () => LineReadingsState.Reading(target),
      readingFix: form =>
        form._tag === 'Open' && isReadingsFor(form, target)
          ? form
          : ReadingFixForm.Closed(),
    }),
    commands: [...(result.commands ?? []), ReadLineReadings(target)],
  }
}

// Clearing everything or restoring a backup changes the settings, so the
// next line reads the choice again.
export const forgetChoice = (model: Model): Model =>
  modifyFields(model, { readingsChoice: () => ReadingsChoice.NotRead() })
