import { Array, Effect, Schema } from 'effect'
import { Command, Dom, Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { lineRowAttribute } from '../../history/commands'
import { rowsPerPage } from '../../history/history'
import { lineList, linesFound } from '../../history/lineList'
import { type DevEntry, entryFrame } from '../entry'
import { sampleSummary } from '../sampleHistory'

// The lines practised on /history, in the app's frame for a long list,
// over the sample history's 200 lines. The words stay in this page's
// Model, where the app keeps them in the address.

// MODEL

export const Model = Schema.Struct({
  words: Schema.String,
  shownRows: Schema.Finite,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ChangedWords: { words: Schema.String },
  ClickedShowMore: {},
  CompletedFocusRow: {},
})
export type Message = typeof Message.Type

// COMMAND

export const FocusRow = Command.define('FocusRow', {
  args: { index: Schema.Finite },
  messages: [Message.CompletedFocusRow],
  execute: ({ index }) =>
    Dom.focus(`[data-${lineRowAttribute}="${index}"]`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusRow()),
    ),
})

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { words: '', shownRows: rowsPerPage },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ChangedWords: ({ words }) => ({
      model: modifyFields(model, {
        words: () => words,
        shownRows: () => rowsPerPage,
      }),
    }),
    ClickedShowMore: () => ({
      model: modifyFields(model, { shownRows: rows => rows + rowsPerPage }),
      commands: [FocusRow({ index: model.shownRows })],
    }),
    CompletedFocusRow: () => ({ model }),
  })

// VIEW

export const readOut = (model: Model): string => {
  const found = linesFound(sampleSummary.lines, model.words)
  return `${Math.min(found.length, model.shownRows)} of ${found.length} rows shown`
}

export const choices: ReadonlyArray<string> = [
  'Lines are listed by when they were last practised. Would a sort by best match, or by the fewest takes, help choose what to practise next?',
  'Each row shows its takes, best match and last day. Is the latest match more use than the best?',
  `The find field appears past 12 lines and matches the line's text anywhere. Should it also find by the clip a line came from?`,
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'History list',
      summary: `The lines practised, ${Array.length(sampleSummary.lines)} of them from the sample history.`,
      demo: [
        lineList(
          {
            lines: sampleSummary.lines,
            words: model.words,
            shownRows: model.shownRows,
            changedWords: words => Message.ChangedWords({ words }),
            showMore: Message.ClickedShowMore(),
          },
          h,
        ),
      ],
      readOut: readOut(model),
      choices,
    },
    h,
  )

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
