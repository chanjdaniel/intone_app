import { Schema } from 'effect'
import { Calendar, Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { monthTotals, practiceCalendar } from '../../history/calendar'
import { monthText } from '../../history/format'
import { type DevEntry, entryFrame } from '../entry'
import { sampleSummary } from '../sampleHistory'

// The practice calendar on /history, over the library's sample history.

const today = Calendar.make(2026, 11, 10)
const firstMonth = Calendar.make(2026, 1, 1)
const thisMonth = Calendar.firstOfMonth(today)

const takesByDay: ReadonlyMap<string, number> = new Map(
  sampleSummary.days.map(({ day, takes }) => [day, takes]),
)

// MODEL

export const Model = Schema.Struct({ month: Calendar.CalendarDate })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedPreviousMonth: {},
  ClickedNextMonth: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { month: thisMonth },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedPreviousMonth: () => ({
      model: modifyFields(model, {
        month: month =>
          Calendar.isAfter(month, firstMonth)
            ? Calendar.subtractMonths(month, 1)
            : month,
      }),
    }),
    ClickedNextMonth: () => ({
      model: modifyFields(model, {
        month: month =>
          Calendar.isBefore(month, thisMonth)
            ? Calendar.addMonths(month, 1)
            : month,
      }),
    }),
  })

// VIEW

export const readOut = (model: Model): string => {
  const { days, takes } = monthTotals(model.month, takesByDay)
  return `${monthText(model.month)}: ${days} days practised, ${takes} takes`
}

export const choices: ReadonlyArray<string> = [
  'A practised day is filled, today is ringed, and a day with no take is a plain number: nothing marks a gap or counts a run. Is a filled day enough, or should a busy day look busier than a light one?',
  'The calendar opens on the month of the latest day practised and steps a month at a time. Would a year at a glance, smaller, serve better on a wide screen?',
  'Weeks start on Monday. Should they follow the device’s locale instead?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Practice calendar',
      summary:
        'The days a learner practised, a month at a time, from 2,000 sample takes.',
      demo: [
        practiceCalendar(
          {
            month: model.month,
            today,
            takesByDay,
            canShowPrevious: Calendar.isAfter(model.month, firstMonth),
            canShowNext: Calendar.isBefore(model.month, thisMonth),
            previous: Message.ClickedPreviousMonth(),
            next: Message.ClickedNextMonth(),
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
