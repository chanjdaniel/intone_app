import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { type ReadingWord, fixedWords } from '../../engine/text/readings'
import type { LineReadings } from '../../services/history-records'
import { shownLineOf } from '../line/native'
import type { Model } from '../model'
import { TextFormStatus } from '../text/text'

// A line's readings in the Model (docs/readings.md): whether the learner
// shows them, which the device keeps; the readings Worker, held while a
// line with Japanese text is open with readings shown
// (./resources.ts); the open line's words with their kana; and the form
// that corrects them. Readings are display only: no score reads them,
// and the Model gets one line's words at a time, never the dictionary.

export const ReadingsShown = Schema.Literals(['Shown', 'Hidden'])
export type ReadingsShown = typeof ReadingsShown.Type

// What the learner chose, read from the device when a line opens; none
// until they first turn readings on, so the download's size is shown.
export const ReadingsChoice = defineTaggedUnion({
  NotRead: {},
  Read: { maybeShown: Schema.Option(ReadingsShown) },
})
export type ReadingsChoice = typeof ReadingsChoice.Type

// The readings Worker, as Foldkit holds it; while it is wanted and none
// of these, it is loading.
export const ReadingsTool = defineTaggedUnion({
  Released: {},
  Acquired: {},
  Failed: { reason: Schema.String },
})
export type ReadingsTool = typeof ReadingsTool.Type

// A word of the line, by its place in the text, with the kana shown over
// it (the learner's, when `fixed`) and the dictionary's.
export const ShownWord = Schema.Struct({
  from: Schema.Finite,
  to: Schema.Finite,
  surface: Schema.String,
  maybeKana: Schema.Option(Schema.String),
  maybeDictionaryKana: Schema.Option(Schema.String),
  fixed: Schema.Boolean,
})
export type ShownWord = typeof ShownWord.Type

const lineText = {
  clipId: Schema.String,
  lineId: Schema.String,
  text: Schema.String,
}

export const LineReadingsState = defineTaggedUnion({
  Idle: {},
  Reading: lineText,
  Ready: { ...lineText, words: Schema.Array(ShownWord) },
  Failed: { ...lineText, reason: Schema.String },
})
export type LineReadingsState = typeof LineReadingsState.Type

// A word's reading as the learner writes it in the form.
export const ReadingDraft = Schema.Struct({
  from: Schema.Finite,
  to: Schema.Finite,
  surface: Schema.String,
  draft: Schema.String,
  maybeDictionaryKana: Schema.Option(Schema.String),
})
export type ReadingDraft = typeof ReadingDraft.Type

export const ReadingFixForm = defineTaggedUnion({
  Closed: {},
  Open: {
    ...lineText,
    drafts: Schema.Array(ReadingDraft),
    status: TextFormStatus,
  },
})
export type ReadingFixForm = typeof ReadingFixForm.Type

export type ReadingsTarget = Readonly<{
  clipId: string
  lineId: string
  text: string
}>

export const isShown = (choice: ReadingsChoice): boolean =>
  choice._tag === 'Read' && Option.getOrUndefined(choice.maybeShown) === 'Shown'

// The open line's text, when the learner shows its readings: on a line's
// practice screen, once the line is known and has Japanese text.
export const readingsTarget = (model: Model): Option.Option<ReadingsTarget> =>
  model.route._tag !== 'Line' || !isShown(model.readingsChoice)
    ? Option.none()
    : shownLineOf(model.native, model.route.clipId, model.route.lineId).pipe(
        Option.filter(line => line.titleIsText),
        Option.map(line => ({
          clipId: line.clipId,
          lineId: line.lineId,
          text: line.title,
        })),
      )

export const isReadingsFor = (
  state: Readonly<{ clipId: string; lineId: string; text: string }>,
  target: ReadingsTarget,
): boolean =>
  state.clipId === target.clipId &&
  state.lineId === target.lineId &&
  state.text === target.text

// The line's words as the screen shows them: the dictionary's, with the
// learner's corrections over them when they were made on this text.
export const shownWordsOf = (
  text: string,
  words: ReadonlyArray<ReadingWord>,
  kept: Option.Option<LineReadings>,
): ReadonlyArray<ShownWord> => {
  const fixes = Option.match(kept, {
    onNone: () => [],
    onSome: readings => (readings.text === text ? readings.fixes : []),
  })
  return fixedWords(words, fixes).map((word, k) => ({
    from: word.from,
    to: word.to,
    surface: word.surface,
    maybeKana: Option.fromNullishOr(word.kana),
    maybeDictionaryKana: Option.fromNullishOr(words[k]?.kana),
    fixed: word.fixed,
  }))
}

export const readingFieldId = (from: number): string => `reading-${from}`
