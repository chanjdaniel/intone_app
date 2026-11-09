import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { countText } from '../history/format'
import { levelRouter } from '../route'
import type { ClipSummary } from './level'
import { lengthText } from './levelView'

// One of the learner's clips, as the home screen lists it: its name, how
// many lines it has and how long it is, the whole row a link to its
// lines.

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export const clipRow = <ViewMessage>(
  clip: ClipSummary,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.a(
    [
      h.Href(levelRouter({ clipId: clip.id, maybeFind: Option.none() })),
      h.Class(
        `flex min-h-11 items-center justify-between gap-4 rounded-lg border border-line bg-raised p-4 text-ink hover:border-accent sm:p-5 ${focusRing}`,
      ),
    ],
    [
      h.span(
        [h.Class('flex min-w-0 flex-col gap-1')],
        [
          h.span([h.Class('text-xl font-bold break-words')], [clip.name]),
          h.span([h.Class('sr-only')], [', ']),
          h.span(
            [h.Class('text-sm text-muted')],
            [
              `${countText(clip.lines, 'line')} · ${lengthText(clip.seconds)} long${clip.hasAudio ? '' : ' · audio not on this device'}`,
            ],
          ),
        ],
      ),
      h.span(
        [
          h.AriaHidden(true),
          h.Class('shrink-0 text-base font-semibold text-accent'),
        ],
        ['Lines →'],
      ),
    ],
  )
