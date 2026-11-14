import type { Html, HtmlBuilder } from 'foldkit/html'

import { lineRouter } from '../route'
import type { BundledLine } from './lines'

// One line to copy, as the home screen lists it: its text and reading, and
// who is speaking, the whole row a link to its practice screen.

export const linePath = (line: Pick<BundledLine, 'clipId' | 'lineId'>) =>
  lineRouter({ clipId: line.clipId, lineId: line.lineId })

export const lineRow = <ViewMessage>(
  line: BundledLine,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.a(
    [
      h.Href(linePath(line)),
      // NOTE: the name holds all the text the row shows, the credit too, so
      // speaking what is on screen reaches it (WCAG 2.5.3, Label in Name).
      h.AriaLabel(`Copy ${line.text}, ${line.reading}, ${line.credit}`),
      h.Class(
        `flex min-h-11 items-center justify-between gap-4 rounded-lg border border-line bg-raised p-4 text-ink hover:border-accent sm:p-5 focus-ring`,
      ),
    ],
    [
      h.span(
        [h.Class('flex min-w-0 flex-col gap-1')],
        [
          h.span([h.Lang('ja'), h.Class('text-2xl font-bold')], [line.text]),
          h.span(
            [h.Lang('ja'), h.Class('text-base text-muted')],
            [line.reading],
          ),
          h.span([h.Class('text-sm text-muted break-words')], [line.credit]),
        ],
      ),
      h.span(
        [
          h.AriaHidden(true),
          h.Class('shrink-0 text-base font-semibold text-accent'),
        ],
        ['Copy →'],
      ),
    ],
  )
