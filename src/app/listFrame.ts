import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

// The app's one frame for a long list (spec, "Frontend patterns
// applied"): a find field once the list is longer than `findFromRows`,
// a count line said as it changes, the first page of rows and "Show N
// more". The field stays while the list is long, whatever it holds, so
// it never moves under a press; the words live in the address, and each
// screen finds rows by them trimmed.

export type ListFrame<Row, ViewMessage> = Readonly<{
  // Every row, and those the words find, in order.
  rows: ReadonlyArray<Row>
  found: ReadonlyArray<Row>
  words: string
  shownRows: number
  findFromRows: number
  rowsPerPage: number
  find: Readonly<{
    inputId: string
    label: string
    placeholder?: string
    // The words are Japanese text, read as such.
    isJapanese?: boolean
  }>
  countLine: string
  changedWords: (words: string) => ViewMessage
  showMore: ViewMessage
  moreButtonClass: string
  // A row, by its place among those shown, for the focus after "Show N
  // more"; each is keyed by the screen.
  row: (row: Row, index: number) => Html
}>

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export const listFrame = <Row, ViewMessage>(
  list: ListFrame<Row, ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const shown = Array.take(list.found, list.shownRows)
  const more = Math.min(list.rowsPerPage, list.found.length - shown.length)
  return h.div(
    [h.Class('flex flex-col gap-3')],
    [
      ...(list.rows.length > list.findFromRows
        ? [
            h.div(
              [h.Class('flex flex-col gap-1')],
              [
                h.label(
                  [
                    h.For(list.find.inputId),
                    h.Class('text-base font-semibold'),
                  ],
                  [list.find.label],
                ),
                h.input([
                  h.Id(list.find.inputId),
                  h.Type('search'),
                  h.Value(list.words),
                  ...(list.find.isJapanese === true ? [h.Lang('ja')] : []),
                  ...(list.find.placeholder === undefined
                    ? []
                    : [h.Placeholder(list.find.placeholder)]),
                  h.Autocomplete('off'),
                  h.Spellcheck(false),
                  h.OnInput(list.changedWords),
                  h.Class(
                    `min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted ${focusRing}`,
                  ),
                ]),
              ],
            ),
          ]
        : []),
      h.p([h.Role('status'), h.Class('text-sm text-muted')], [list.countLine]),
      h.ul(
        [h.Class('flex flex-col gap-2')],
        shown.map((row, index) => list.row(row, index)),
      ),
      ...(more > 0
        ? [
            h.button(
              [
                h.Type('button'),
                h.OnClick(list.showMore),
                h.Class(`${list.moreButtonClass} self-start`),
              ],
              [`Show ${more} more`],
            ),
          ]
        : []),
    ],
  )
}
