import { Array, Option } from 'effect'
import { Calendar } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { pageFrame } from '../pageFrame'
import { homeRouter } from '../route'
import { practiceCalendar } from './calendar'
import { countText } from './format'
import { HistoryPage, Rescoring } from './history'
import { lineList } from './lineList'

// /history: the days practised, a month at a time, and the lines
// practised, each opening its own history; and, when the score has
// changed since some takes were scored, the offer to score them again.

export type HistoryEvents<ViewMessage> = Readonly<{
  previousMonth: ViewMessage
  nextMonth: ViewMessage
  changedWords: (words: string) => ViewMessage
  showMore: ViewMessage
  rescore: ViewMessage
}>

const section = <ViewMessage>(
  id: string,
  heading: string,
  body: ReadonlyArray<Html>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.section(
    [h.AriaLabelledBy(id), h.Class('flex flex-col gap-4')],
    [h.h2([h.Id(id), h.Class('text-xl font-bold')], [heading]), ...body],
  )

const rescoreBox = <ViewMessage>(
  outdated: number,
  rescoring: Rescoring,
  rescore: ViewMessage,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const text = Rescoring.match(rescoring, {
    Running: ({ done, total }) => `Scoring again: ${done} of ${total} takes.`,
    Done: ({ rescored }) =>
      `${countText(rescored, 'take')} scored again with the score as it is now.`,
    Failed: ({ reason }) => `Scoring again stopped: ${reason}`,
    Idle: () => '',
  })
  const offer =
    outdated > 0 && rescoring._tag !== 'Running'
      ? [
          h.p(
            [h.Class('text-base text-ink')],
            [
              `${countText(outdated, 'take was', 'takes were')} scored by an earlier version of the score. Scoring them again from their kept curves puts every take on the same scale.`,
            ],
          ),
          h.button(
            [
              h.Type('button'),
              h.OnClick(rescore),
              h.Class('button-primary self-start'),
            ],
            [`Score ${countText(outdated, 'take')} again`],
          ),
        ]
      : []
  if (outdated === 0 && rescoring._tag === 'Idle') {
    return h.empty
  }
  return h.div(
    [
      h.Class(
        'flex flex-col gap-3 rounded-lg border border-line bg-raised p-4',
      ),
    ],
    [
      ...offer,
      h.p(
        [h.Role('status'), h.Class('text-base text-muted empty:hidden')],
        [text],
      ),
    ],
  )
}

const emptyHistory = <ViewMessage>(h: HtmlBuilder<ViewMessage>): Html =>
  h.div(
    [
      h.Class(
        'flex flex-col items-start gap-3 rounded-lg border border-line bg-raised p-5',
      ),
    ],
    [
      h.p(
        [h.Class('text-base text-ink')],
        [
          'No takes yet. Each take you record is kept here, on this device, with its curve and its match.',
        ],
      ),
      h.a(
        [h.Href(homeRouter({ maybeFind: Option.none() })), h.Class(`link`)],
        ['Choose a line to copy'],
      ),
    ],
  )

const statusBox = <ViewMessage>(
  text: string,
  role: 'status' | 'alert',
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.p(
    [
      h.Role(role),
      h.Class(
        `rounded-lg border border-line bg-raised p-5 text-base break-words ${role === 'alert' ? 'text-bad' : 'text-muted'}`,
      ),
    ],
    [text],
  )

export const historyView = <ViewMessage>(
  page: HistoryPage,
  maybeWords: Option.Option<string>,
  events: HistoryEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const heading = h.header(
    [h.Class('flex flex-col gap-2')],
    [
      h.h1([h.Class('text-3xl font-bold sm:text-5xl')], ['Your history']),
      h.p(
        [h.Class('text-base text-muted')],
        ['Every take is kept on this device, and nowhere else.'],
      ),
    ],
  )
  const reading = (): ReadonlyArray<Html> => [
    statusBox('Reading your history from this device.', 'status', h),
  ]
  const body = HistoryPage.match<ReadonlyArray<Html>>(page, {
    NotLoaded: reading,
    Loading: reading,
    Failed: ({ reason }) => [
      statusBox(`Your history could not be read. ${reason}`, 'alert', h),
    ],
    Ready: page => {
      if (!Array.isReadonlyArrayNonEmpty(page.lines)) {
        return [emptyHistory(h)]
      }
      const takesByDay = new Map(
        page.days.map(({ day, takes }) => [day, takes]),
      )
      const firstMonth = Option.match(Array.head(page.days), {
        onNone: () => Calendar.firstOfMonth(page.today),
        onSome: ({ day }) => {
          const [year = 0, month = 1] = day.split('-').map(Number)
          return Calendar.make(year, month, 1)
        },
      })
      return [
        rescoreBox(page.outdatedIds.length, page.rescoring, events.rescore, h),
        ...(page.unreadable > 0
          ? [
              statusBox(
                `${countText(page.unreadable, 'take')} on this device could not be read, and ${page.unreadable === 1 ? 'is' : 'are'} left out.`,
                'status',
                h,
              ),
            ]
          : []),
        section(
          'calendar-heading',
          'Days you practised',
          [
            practiceCalendar(
              {
                month: page.month,
                today: page.today,
                takesByDay,
                canShowPrevious: Calendar.isAfter(page.month, firstMonth),
                canShowNext: Calendar.isBefore(
                  page.month,
                  Calendar.firstOfMonth(page.today),
                ),
                previous: events.previousMonth,
                next: events.nextMonth,
              },
              h,
            ),
          ],
          h,
        ),
        section(
          'lines-practised-heading',
          'Lines you practised',
          [
            lineList(
              {
                lines: page.lines,
                words: Option.getOrElse(maybeWords, () => ''),
                shownRows: page.shownRows,
                changedWords: events.changedWords,
                showMore: events.showMore,
              },
              h,
            ),
          ],
          h,
        ),
      ]
    },
  })
  return pageFrame('History', [heading, ...body], h)
}
