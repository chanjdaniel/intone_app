import { Effect, Option, Schema } from 'effect'
import { Command, Dom, Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { dayText } from '../../history/format'
import { dueRowAttribute } from '../../returns/commands'
import { dueSection } from '../../returns/dueList'
import { DuePage, dueLinesFound, dueRowsPerPage } from '../../returns/returns'
import { type DevEntry, buttonFocusClass, entryFrame } from '../entry'
import { sampleDue, sampleToday } from '../sampleReturns'

// The home screen's lines due back for a blind take, in the app's frame
// for a long list, from the sample learner's takes on the sample's
// today; and the same section with none due. The words stay in this
// page's Model, where the app keeps them in the address.

// MODEL

const Showing = Schema.Literals(['Due', 'NoneDue'])

export const Model = Schema.Struct({
  showing: Showing,
  words: Schema.String,
  shownRows: Schema.Finite,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedShow: { showing: Showing },
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
    Dom.focus(`[data-${dueRowAttribute}="${index}"]`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusRow()),
    ),
})

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { showing: 'Due', words: '', shownRows: dueRowsPerPage },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedShow: ({ showing }) => ({
      model: modifyFields(model, { showing: () => showing }),
    }),
    ChangedWords: ({ words }) => ({
      model: modifyFields(model, {
        words: () => words,
        shownRows: () => dueRowsPerPage,
      }),
    }),
    ClickedShowMore: () => ({
      model: modifyFields(model, { shownRows: rows => rows + dueRowsPerPage }),
      commands: [FocusRow({ index: model.shownRows })],
    }),
    CompletedFocusRow: () => ({ model }),
  })

// VIEW

const secondaryButton = `inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-surface px-5 text-base font-semibold text-accent hover:border-accent ${buttonFocusClass}`

export const readOut = (model: Model): string => {
  const found = dueLinesFound(sampleDue.due, model.words)
  return `${found.length} of ${sampleDue.due.length} lines due on ${dayText(sampleToday)} found`
}

export const choices: ReadonlyArray<string> = [
  'Lines due longest are listed first. Would the lines nearest to slipping, the ones with the longest gap before them, be a better order?',
  'A line due since an earlier day looks the same as one due today, with no count of days. Is that the right amount of nothing?',
  'Each row says when its last blind take was. Would its next step, such as "next: in 7 days if it holds", help more?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Lines due back',
      summary: `The lines due back for a blind take on ${dayText(sampleToday)}, ${sampleDue.due.length} of them from the sample learner, and the section with none due.`,
      demo: [
        h.div(
          [h.Role('group'), h.AriaLabel('Show'), h.Class('flex gap-2')],
          (['Due', 'NoneDue'] as const).map(showing =>
            h.button(
              [
                h.Type('button'),
                h.AriaPressed(model.showing === showing ? 'true' : 'false'),
                h.OnClick(Message.ClickedShow({ showing })),
                h.Class(
                  `${secondaryButton} aria-pressed:border-accent aria-pressed:bg-raised`,
                ),
              ],
              [showing === 'Due' ? 'Lines due' : 'None due'],
            ),
          ),
        ),
        dueSection(
          DuePage.Ready({
            today: sampleToday,
            lines: model.showing === 'Due' ? sampleDue.due : [],
            maybeNextOn:
              model.showing === 'Due'
                ? sampleDue.maybeNextOn
                : Option.some('2026-12-22'),
            shownRows: model.shownRows,
          }),
          model.words,
          {
            changedWords: words => Message.ChangedWords({ words }),
            showMore: Message.ClickedShowMore(),
          },
          secondaryButton,
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
