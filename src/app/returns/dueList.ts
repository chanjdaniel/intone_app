import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { returnStepDays } from '../../score/constants'
import { starThresholds } from '../../score/stars'
import { countText, dayText } from '../history/format'
import { starRow } from '../level/starRow'
import { listFrame } from '../listFrame'
import { lineRouter } from '../route'
import { dueRowAttribute } from './commands'
import {
  type DueLine,
  DuePage,
  dueFindFromRows,
  dueKeyOf,
  dueLinesFound,
  dueRowsPerPage,
} from './returns'

// The home screen's lines due back for a blind take, each row a link to
// its practice screen, in the large-list frame. A line due since an
// earlier day is listed as any other: no warning, no count of days, and
// nothing lost by it. With none due, it says so, and when the next comes.

export type DueListEvents<ViewMessage> = Readonly<{
  changedWords: (words: string) => ViewMessage
  showMore: ViewMessage
}>

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export const dueFindInputId = 'find-due-lines'

// A row's second line, before the day of its last blind take, which is
// kept on one line: its level, unless the level is named by the line
// itself, as a bundled clip of one line is.
export const dueRowLead = (line: DueLine): string =>
  [
    ...(line.levelName === line.title ? [] : [line.levelName]),
    'last blind take',
  ].join(' · ')

const dueRow = <ViewMessage>(
  line: DueLine,
  index: number,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.keyed('li')(
    dueKeyOf(line),
    [],
    [
      h.a(
        [
          h.Href(lineRouter({ clipId: line.clipId, lineId: line.lineId })),
          h.DataAttribute(dueRowAttribute, String(index)),
          h.Class(
            `flex min-h-11 items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3 text-ink hover:border-accent ${focusRing}`,
          ),
        ],
        [
          h.span(
            [h.Class('flex min-w-0 flex-col gap-0.5')],
            [
              h.span(
                [
                  ...(line.titleIsText ? [h.Lang('ja')] : []),
                  h.Class('text-xl font-bold break-words'),
                ],
                [line.title],
              ),
              // NOTE: a row's lines are one link's name; this keeps a
              // pause between them for a screen reader.
              h.span([h.Class('sr-only')], [', ']),
              h.span(
                [h.Class('text-sm text-muted break-words')],
                [
                  `${dueRowLead(line)} `,
                  h.span(
                    [h.Class('whitespace-nowrap')],
                    [dayText(line.lineReturn.setOn)],
                  ),
                ],
              ),
            ],
          ),
          h.span(
            [
              h.Class(
                'flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3',
              ),
            ],
            [
              starRow(line.stars, h),
              h.span(
                [
                  h.AriaHidden(true),
                  h.Class('text-base font-semibold text-accent'),
                ],
                ['Blind →'],
              ),
            ],
          ),
        ],
      ),
    ],
  )

// How lines come back, by the steps in ../../score/constants.ts.
export const scheduleText = (): string => {
  const steps = returnStepDays.map(String)
  const reach = `${Math.round(100 * starThresholds().reach)}%`
  return `Lines come back ${steps.slice(0, -1).join(', ')} and ${steps.at(-1) ?? ''} days after each blind take of ${reach} or more, and the next day after one under it.`
}

const countLine = (found: number, all: number, words: string): string =>
  words.trim() === ''
    ? `${countText(all, 'line')} due back today`
    : `${countText(found, 'line')} of ${all} found for “${words.trim()}”`

const noneDue = <ViewMessage>(
  maybeNextOn: Option.Option<string>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.p(
    [h.Class('text-base text-muted')],
    [
      Option.match(maybeNextOn, {
        onNone: () =>
          'No lines are due back today. A line you take blind comes back here on a later day, for another blind take.',
        onSome: on =>
          `No lines are due back today. The next comes back on ${dayText(on)}.`,
      }),
    ],
  )

export const dueSection = <ViewMessage>(
  page: DuePage,
  words: string,
  events: DueListEvents<ViewMessage>,
  secondaryButton: string,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.section(
    [
      h.AriaLabelledBy('due-heading'),
      h.DataAttribute('due-lines', ''),
      h.Class('flex flex-col gap-4'),
    ],
    [
      h.div(
        [h.Class('flex flex-col gap-1')],
        [
          h.h2(
            [h.Id('due-heading'), h.Class('text-xl font-bold')],
            ['Back for a blind take'],
          ),
          h.p([h.Class('text-sm text-muted')], [scheduleText()]),
        ],
      ),
      DuePage.match(page, {
        NotLoaded: () => h.empty,
        Loading: () => h.empty,
        Failed: ({ reason }) =>
          h.p(
            [h.Role('alert'), h.Class('text-base text-bad break-words')],
            [`The lines due back could not be read. ${reason}`],
          ),
        Ready: ({ lines, maybeNextOn, shownRows }) =>
          Array.match(lines, {
            onEmpty: () => noneDue(maybeNextOn, h),
            onNonEmpty: () =>
              dueList(lines, words, shownRows, events, secondaryButton, h),
          }),
      }),
    ],
  )

const dueList = <ViewMessage>(
  lines: ReadonlyArray<DueLine>,
  words: string,
  shownRows: number,
  events: DueListEvents<ViewMessage>,
  secondaryButton: string,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const found = dueLinesFound(lines, words)
  return listFrame(
    {
      rows: lines,
      found,
      words,
      shownRows,
      findFromRows: dueFindFromRows,
      rowsPerPage: dueRowsPerPage,
      find: {
        inputId: dueFindInputId,
        label: 'Find a line due back',
        placeholder: 'Its words, or its level’s name',
      },
      countLine: countLine(found.length, lines.length, words),
      changedWords: events.changedWords,
      showMore: events.showMore,
      moreButtonClass: secondaryButton,
      row: (line, index) => dueRow(line, index, h),
    },
    h,
  )
}
