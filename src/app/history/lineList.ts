import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

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

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

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
            `flex min-h-11 items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3 text-ink hover:border-accent ${focusRing}`,
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
  const shown = Array.take(found, list.shownRows)
  const more = Math.min(rowsPerPage, found.length - shown.length)
  return h.div(
    [h.Class('flex flex-col gap-3')],
    [
      ...(list.lines.length > findFieldFromRows
        ? [
            h.div(
              [h.Class('flex flex-col gap-1')],
              [
                h.label(
                  [h.For(findInputId), h.Class('text-base font-semibold')],
                  ['Find a line'],
                ),
                h.input([
                  h.Id(findInputId),
                  h.Type('search'),
                  h.Value(list.words),
                  h.Lang('ja'),
                  h.Autocomplete('off'),
                  h.Spellcheck(false),
                  h.OnInput(list.changedWords),
                  h.Class(
                    `min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink ${focusRing}`,
                  ),
                ]),
              ],
            ),
          ]
        : []),
      h.p(
        [h.Role('status'), h.Class('text-sm text-muted')],
        [countLine(found.length, list.lines.length, list.words)],
      ),
      h.ul(
        [h.Class('flex flex-col gap-2')],
        shown.map((line, index) => lineRow(line, index, h)),
      ),
      ...(more > 0
        ? [
            h.button(
              [
                h.Type('button'),
                h.OnClick(list.showMore),
                h.Class(
                  `inline-flex min-h-11 items-center justify-center self-start rounded-md border border-line bg-surface px-5 text-base font-semibold text-ink ${focusRing}`,
                ),
              ],
              [`Show ${more} more`],
            ),
          ]
        : []),
    ],
  )
}
