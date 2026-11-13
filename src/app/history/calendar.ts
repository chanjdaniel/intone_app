import { Array } from 'effect'
import { Calendar } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { countText, isoDayOf, monthName, monthText } from './format'

// The practice calendar: a month at a time, each day the learner made a
// take marked, with how many. It counts only what was done: a day with
// no take is a plain day, never a gap, a broken run or a warning.

export type PracticeCalendar<ViewMessage> = Readonly<{
  // The month shown: its first day.
  month: Calendar.CalendarDate
  today: Calendar.CalendarDate
  // Takes by the learner's day, `YYYY-MM-DD`.
  takesByDay: ReadonlyMap<string, number>
  canShowPrevious: boolean
  canShowNext: boolean
  previous: ViewMessage
  next: ViewMessage
}>

const weekdays = [
  ['Mon', 'Monday'],
  ['Tue', 'Tuesday'],
  ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'],
  ['Fri', 'Friday'],
  ['Sat', 'Saturday'],
  ['Sun', 'Sunday'],
] as const

// The month's weeks, Monday first, each day in it or null.
export const weeksOf = (
  month: Calendar.CalendarDate,
): ReadonlyArray<ReadonlyArray<Calendar.CalendarDate | null>> => {
  const first = Calendar.firstOfMonth(month)
  const lead = Calendar.daysUntil(Calendar.startOfWeek(first, 'Monday'), first)
  const length = Calendar.daysInMonth(month.year, month.month)
  const cells = Math.ceil((lead + length) / 7) * 7
  return Array.chunksOf(
    Array.makeBy(cells, index =>
      index < lead || index >= lead + length
        ? null
        : Calendar.addDays(first, index - lead),
    ),
    7,
  )
}

// The days practised in `month`, and the takes made on them.
export const monthTotals = (
  month: Calendar.CalendarDate,
  takesByDay: ReadonlyMap<string, number>,
): Readonly<{ days: number; takes: number }> => {
  const prefix = isoDayOf(Calendar.firstOfMonth(month)).slice(0, 8)
  return [...takesByDay].reduce(
    (totals, [day, takes]) =>
      day.startsWith(prefix)
        ? { days: totals.days + 1, takes: totals.takes + takes }
        : totals,
    { days: 0, takes: 0 },
  )
}

const monthButton = <ViewMessage>(
  label: string,
  arrow: string,
  enabled: boolean,
  message: ViewMessage,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel(label),
      ...(enabled ? [h.OnClick(message)] : [h.Disabled(true)]),
      h.Class(
        `inline-flex size-11 items-center justify-center rounded-md border border-line bg-surface text-lg text-ink disabled:text-line focus-ring`,
      ),
    ],
    [h.span([h.AriaHidden(true)], [arrow])],
  )

const dayCell = <ViewMessage>(
  date: Calendar.CalendarDate | null,
  today: Calendar.CalendarDate,
  takesByDay: ReadonlyMap<string, number>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  if (date === null) {
    return h.td([h.Class('p-0.5')])
  }
  const takes = takesByDay.get(isoDayOf(date)) ?? 0
  const isToday = Calendar.isEqual(date, today)
  const spoken = `${date.day} ${monthName(date.month)}${isToday ? ', today' : ''}: ${
    takes === 0 ? 'no takes' : countText(takes, 'take')
  }`
  return h.td(
    [h.Class('p-0.5 text-center')],
    [
      h.span(
        [
          h.AriaHidden(true),
          h.Class(
            `mx-auto flex size-9 items-center justify-center rounded-full text-sm sm:size-10 sm:text-base ${
              takes > 0
                ? 'bg-accent font-semibold text-on-accent'
                : 'text-muted'
            } ${isToday ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`,
          ),
        ],
        [String(date.day)],
      ),
      h.span([h.Class('sr-only')], [spoken]),
    ],
  )
}

export const practiceCalendar = <ViewMessage>(
  calendar: PracticeCalendar<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const { month, today, takesByDay } = calendar
  const totals = monthTotals(month, takesByDay)
  const previousMonth = Calendar.subtractMonths(month, 1)
  const nextMonth = Calendar.addMonths(month, 1)
  return h.div(
    [h.Class('flex flex-col gap-4')],
    [
      h.div(
        [h.Class('flex items-center justify-between gap-3')],
        [
          monthButton(
            `Show ${monthText(previousMonth)}`,
            '‹',
            calendar.canShowPrevious,
            calendar.previous,
            h,
          ),
          h.p(
            [h.AriaLive('polite'), h.Class('text-center')],
            [
              h.span([h.Class('block text-lg font-bold')], [monthText(month)]),
              h.span(
                [h.Class('block text-sm text-muted')],
                [
                  totals.days === 0
                    ? 'No takes this month'
                    : `${countText(totals.days, 'day')} practised, ${countText(totals.takes, 'take')}`,
                ],
              ),
            ],
          ),
          monthButton(
            `Show ${monthText(nextMonth)}`,
            '›',
            calendar.canShowNext,
            calendar.next,
            h,
          ),
        ],
      ),
      h.table(
        [h.Class('w-full table-fixed border-collapse')],
        [
          h.caption(
            [h.Class('sr-only')],
            [`Days practised in ${monthText(month)}`],
          ),
          h.thead(
            [],
            [
              h.tr(
                [],
                weekdays.map(([short, long]) =>
                  h.th(
                    [
                      h.Scope('col'),
                      h.Class(
                        'pb-1 text-xs font-semibold text-muted sm:text-sm',
                      ),
                    ],
                    [
                      h.span([h.AriaHidden(true)], [short]),
                      h.span([h.Class('sr-only')], [long]),
                    ],
                  ),
                ),
              ),
            ],
          ),
          h.tbody(
            [],
            weeksOf(month).map(week =>
              h.tr(
                [],
                week.map(date => dayCell(date, today, takesByDay, h)),
              ),
            ),
          ),
        ],
      ),
    ],
  )
}
