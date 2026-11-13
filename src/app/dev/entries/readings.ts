import { Array, Option, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { hasKanji, isKanaReading, wordsOf } from '../../../engine/text/readings'
import { ReadingFix } from '../../../services/history-records'
import {
  LineReadingsState,
  ReadingFixForm,
  ReadingsChoice,
  ReadingsTool,
  shownWordsOf,
} from '../../readings/readings'
import {
  type ReadingsEvents,
  readingsControls,
  rubyText,
  shownWords,
} from '../../readings/readingsView'
import { TextFormStatus } from '../../text/text'
import { type DevEntry, entryFrame } from '../entry'
import { sampleReadingLines } from '../sampleReadings'

// A line's readings as its practice screen shows them: the heading with
// the kana over its kanji, the button that shows or hides them (with the
// download's size until they are first shown), their loading and failure,
// and the form that edits them, whose edits are kept here, in the
// entry's own Model. The words are the real tokeniser's
// (../sampleReadings.ts).

const Stage = Schema.Literals(['Offered', 'Loading', 'Shown', 'Failed'])
type Stage = typeof Stage.Type

// MODEL

export const Model = Schema.Struct({
  line: Schema.Finite,
  stage: Stage,
  // Each line's edits, by its place in the list.
  fixes: Schema.Array(Schema.Array(ReadingFix)),
  form: ReadingFixForm,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedLine: { line: Schema.Finite },
  ClickedStage: { stage: Stage },
  ClickedShow: {},
  ClickedHide: {},
  ClickedEdit: {},
  ChangedDraft: { from: Schema.Finite, text: Schema.String },
  Submitted: {},
  Cancelled: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    line: 0,
    stage: 'Offered',
    fixes: sampleReadingLines.map(() => []),
    form: ReadingFixForm.Closed(),
  },
})

// UPDATE

const sample = (model: Model) =>
  sampleReadingLines[model.line] ?? sampleReadingLines[0]

const target = (model: Model) => ({
  clipId: 'dev',
  lineId: String(model.line),
  text: sample(model)?.text ?? '',
})

const wordsOfLine = (model: Model) => {
  const line = sample(model)
  const text = line?.text ?? ''
  const fixes = model.fixes[model.line] ?? []
  return shownWordsOf(
    text,
    wordsOf(text, line?.tokens ?? []),
    fixes.length === 0 ? Option.none() : Option.some({ text, fixes }),
  )
}

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match(message, {
    ClickedLine: ({ line }) => ({
      model: modifyFields(model, {
        line: () => line,
        form: () => ReadingFixForm.Closed(),
      }),
    }),
    ClickedStage: ({ stage }) => ({
      model: modifyFields(model, {
        stage: () => stage,
        form: () => ReadingFixForm.Closed(),
      }),
    }),
    ClickedShow: () => ({
      model: modifyFields(model, { stage: () => 'Shown' }),
    }),
    ClickedHide: () => ({
      model: modifyFields(model, {
        stage: () => 'Offered',
        form: () => ReadingFixForm.Closed(),
      }),
    }),
    ClickedEdit: () => ({
      model: modifyFields(model, {
        form: () =>
          ReadingFixForm.Open({
            ...target(model),
            drafts: wordsOfLine(model)
              .filter(word => hasKanji(word.surface))
              .map(word => ({
                from: word.from,
                to: word.to,
                surface: word.surface,
                draft: Option.getOrElse(word.maybeKana, () => ''),
                maybeDictionaryKana: word.maybeDictionaryKana,
              })),
            status: TextFormStatus.Open(),
          }),
      }),
    }),
    ChangedDraft: ({ from, text }) => ({
      model: modifyFields(model, {
        form: form =>
          form._tag === 'Open'
            ? ReadingFixForm.Open({
                ...form,
                drafts: form.drafts.map(draft =>
                  draft.from === from ? { ...draft, draft: text } : draft,
                ),
                status: TextFormStatus.Open(),
              })
            : form,
      }),
    }),
    Submitted: () => {
      const form = model.form
      if (form._tag !== 'Open') {
        return { model }
      }
      const unwritten = form.drafts.find(
        draft =>
          draft.draft.trim() !== '' && !isKanaReading(draft.draft.trim()),
      )
      if (unwritten !== undefined) {
        return {
          model: modifyFields(model, {
            form: () =>
              ReadingFixForm.Open({
                ...form,
                status: TextFormStatus.Refused({
                  reason: `Write the reading of ${unwritten.surface} in kana, or leave it empty for the dictionary’s.`,
                }),
              }),
          }),
        }
      }
      const fixes = form.drafts.flatMap(draft => {
        const kana = draft.draft.trim()
        return kana === '' ||
          kana === Option.getOrUndefined(draft.maybeDictionaryKana)
          ? []
          : [{ from: draft.from, to: draft.to, kana }]
      })
      return {
        model: modifyFields(model, {
          fixes: all => all.map((kept, k) => (k === model.line ? fixes : kept)),
          form: () => ReadingFixForm.Closed(),
        }),
      }
    },
    Cancelled: () => ({
      model: modifyFields(model, { form: () => ReadingFixForm.Closed() }),
    }),
  })

// VIEW

const events: ReadingsEvents<Message> = {
  show: Message.ClickedShow(),
  hide: Message.ClickedHide(),
  edit: Message.ClickedEdit(),
  changeDraft: (from, text) => Message.ChangedDraft({ from, text }),
  submit: Message.Submitted(),
  cancel: Message.Cancelled(),
}

// The app's readings state for the entry's stage.
const stateOf = (model: Model) => {
  const shown = ReadingsChoice.Read({ maybeShown: Option.some('Shown') })
  const line = target(model)
  switch (model.stage) {
    case 'Offered':
      return {
        choice: ReadingsChoice.Read({ maybeShown: Option.none() }),
        tool: ReadingsTool.Released(),
        readings: LineReadingsState.Idle(),
        form: model.form,
      }
    case 'Loading':
      return {
        choice: shown,
        tool: ReadingsTool.Released(),
        readings: LineReadingsState.Idle(),
        form: model.form,
      }
    case 'Failed':
      return {
        choice: shown,
        tool: ReadingsTool.Failed({
          reason: 'The reading dictionary could not be downloaded.',
        }),
        readings: LineReadingsState.Idle(),
        form: model.form,
      }
    case 'Shown':
      return {
        choice: shown,
        tool: ReadingsTool.Acquired(),
        readings: LineReadingsState.Ready({
          ...line,
          words: wordsOfLine(model),
        }),
        form: model.form,
      }
  }
}

const choiceButton = (
  name: string,
  pressed: boolean,
  message: Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaPressed(pressed ? 'true' : 'false'),
      h.OnClick(message),
      h.Class(
        `inline-flex min-h-11 items-center rounded-md border px-4 text-base font-semibold focus-ring ${pressed ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-ink'}`,
      ),
    ],
    [name],
  )

export const readOut = (model: Model): string => {
  const own = (model.fixes[model.line] ?? []).length
  return `line ${model.line + 1}; ${model.stage.toLowerCase()}; ${own} of its readings the learner's own`
}

export const choices: ReadonlyArray<string> = [
  'The kana stand over each run of kanji only, the kana a word is written with left bare (好き reads す over 好). Would you rather have the whole word’s reading over the whole word?',
  'A reading the learner gave is drawn in the accent’s blue, the dictionary’s in grey. Is the difference clear enough, or should an edited reading carry a mark too?',
  'Readings are off until the learner turns them on, which downloads the 12 MB dictionary once. Should a line of text the learner pasted turn them on for that line by itself?',
  'Edits are made in a form of one field a word. Would pressing a word in the heading to edit its reading alone be better?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const state = stateOf(model)
  const text = target(model).text
  const maybeWords = shownWords(state, text)
  return entryFrame(
    {
      title: 'Readings',
      summary:
        'A line’s text with the kana over its kanji, the button that shows or hides them, and the form that edits a reading, as a line’s practice screen shows them.',
      demo: [
        h.div(
          [h.Class('flex flex-col gap-3')],
          [
            h.div(
              [h.Class('flex flex-wrap gap-2')],
              Array.map(sampleReadingLines, (line, k) =>
                choiceButton(
                  `Line ${k + 1}`,
                  model.line === k,
                  Message.ClickedLine({ line: k }),
                  h,
                ),
              ),
            ),
            h.div(
              [h.Class('flex flex-wrap gap-2')],
              Stage.literals.map(stage =>
                choiceButton(
                  stage,
                  model.stage === stage,
                  Message.ClickedStage({ stage }),
                  h,
                ),
              ),
            ),
          ],
        ),
        h.div(
          [
            h.Class(
              'flex flex-col gap-3 rounded-lg border border-line bg-surface p-4',
            ),
          ],
          [
            h.p(
              [
                h.Lang('ja'),
                h.Class(
                  `text-3xl font-bold break-words ${Option.isSome(maybeWords) ? 'leading-[1.75]' : ''}`,
                ),
              ],
              Option.match(maybeWords, {
                onNone: () => [text],
                onSome: words => rubyText(words, h),
              }),
            ),
            readingsControls(state, text, events, h),
          ],
        ),
      ],
      readOut: readOut(model),
      choices,
    },
    h,
  )
}

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
