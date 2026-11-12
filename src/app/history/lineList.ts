import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { listFrame } from '../listFrame'
import { lineHistoryRouter } from '../route'
import { lineRowAttribute } from './commands'
import { countText, dayText, percentText } from './format'
import {
  type LineSummary,
  findFieldFromRows,
  lineKeyOf,
  rowsPerPage,
} from './history'

// The lines practised, in the app's one frame for a long list (spec,
// "Frontend patterns applied"): a find field once there are more than
// 12, a count line, the first 50 rows and "Show N more". The words live
// in the address; a row is found by its text, trimmed words matching
// anywhere in it. Each row opens the line's history.

export type LineList<ViewMessage> = Readonly<{
  lines: ReadonlyArray<LineSummary>
  words: string
  shownRows: number
  changedWords: (words: string) => ViewMessage
  showMore: ViewMessage
}>

export const findInputId = 'find-lines'

export const linesFound = (
  lines: ReadonlyArray<LineSummary>,
  words: string,
): ReadonlyArray<LineSummary> => {
  const wanted = words.trim().toLocaleLowerCase()
  return wanted === ''
    ? lines
    : Array.filter(lines, line =>
        line.lineText.toLocaleLowerCase().includes(wanted),
      )
}

const rowDetail = (line: LineSummary): string =>
  [
    countText(line.takes, 'take'),
    ...Option.match(line.maybeBestMatch, {
      onNone: () => [],
      onSome: best => [`best ${percentText(best)}`],
    }),
    `last ${dayText(line.latestDay)}`,
  ].join(' · ')

const lineRow = <ViewMessage>(
  line: LineSummary,
  index: number,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.keyed('li')(
    lineKeyOf(line),
    [],
    [
      h.a(
        [
          h.Href(
            lineHistoryRouter({ clipId: line.clipId, lineId: line.lineId }),
          ),
          h.DataAttribute(lineRowAttribute, String(index)),
          h.Class(
            `flex min-h-11 items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3 text-ink hover:border-accent focus-ring`,
          ),
        ],
        [
          h.span(
            [h.Class('flex min-w-0 flex-col gap-0.5')],
            [
              h.span(
                [h.Lang('ja'), h.Class('text-xl font-bold break-words')],
                [line.lineText],
              ),
              // NOTE: a row's two lines are one link's name; this keeps
              // a pause between them for a screen reader.
              h.span([h.Class('sr-only')], [', ']),
              h.span([h.Class('text-sm text-muted')], [rowDetail(line)]),
            ],
          ),
          h.span(
            [h.AriaHidden(true), h.Class('shrink-0 text-base text-accent')],
            ['→'],
          ),
        ],
      ),
    ],
  )

const countLine = (found: number, all: number, words: string): string =>
  words.trim() === ''
    ? `${countText(all, 'line')} practised`
    : `${countText(found, 'line')} of ${all} found for “${words.trim()}”`

export const lineList = <ViewMessage>(
  list: LineList<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const found = linesFound(list.lines, list.words)
  return listFrame(
    {
      rows: list.lines,
      found,
      words: list.words,
      shownRows: list.shownRows,
      findFromRows: findFieldFromRows,
      rowsPerPage,
      find: { inputId: findInputId, label: 'Find a line', isJapanese: true },
      countLine: countLine(found.length, list.lines.length, list.words),
      changedWords: list.changedWords,
      showMore: list.showMore,
      moreButtonClass: 'button-secondary',
      row: (line, index) => lineRow(line, index, h),
    },
    h,
  )
}
