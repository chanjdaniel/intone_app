import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { countText } from '../history/format'
import type { BundledClip } from '../line/lines'
import { unreviewedNote } from '../line/starter'
import { levelRouter } from '../route'

// The starter set's levels on the home screen, one row a level in the
// slides' order, from single words to phrases, each a link to its lines;
// and, until the native review has heard them, a word that their accents
// are unchecked (docs/starter-set.md).

const starterLevelRow = <ViewMessage>(
  clip: BundledClip,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.a(
    [
      h.Href(levelRouter({ clipId: clip.id, maybeFind: Option.none() })),
      h.Class(
        'flex min-h-11 items-center justify-between gap-4 rounded-lg border border-line bg-raised p-4 text-ink hover:border-accent sm:p-5 focus-ring',
      ),
    ],
    [
      h.span(
        [h.Class('flex min-w-0 flex-col gap-1')],
        [
          h.span([h.Class('text-xl font-bold break-words')], [clip.name]),
          ...Option.match(clip.maybeAbout, {
            onNone: () => [],
            onSome: about => [
              h.span([h.Class('sr-only')], [', ']),
              h.span([h.Class('text-base text-muted')], [about]),
            ],
          }),
          h.span([h.Class('sr-only')], [', ']),
          h.span(
            [h.Class('text-sm text-muted')],
            [countText(clip.lines.length, 'line')],
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

export const starterLevelsSection = <ViewMessage>(
  levels: ReadonlyArray<BundledClip>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const lines = levels.reduce((sum, level) => sum + level.lines.length, 0)
  const unchecked = levels.some(level => Option.isSome(level.maybeReviewNote))
  return h.section(
    [h.AriaLabelledBy('starter-heading'), h.Class('flex flex-col gap-4')],
    [
      h.h2(
        [h.Id('starter-heading'), h.Class('text-xl font-bold')],
        ['The starter set'],
      ),
      h.p(
        [h.Class('text-base text-muted')],
        [
          `${countText(lines, 'line')} in ${countText(levels.length, 'level')}, by accent pattern, from single words with their particle to short phrases.${unchecked ? ` ${unreviewedNote}` : ''}`,
        ],
      ),
      h.ul(
        [h.Class('flex flex-col gap-3')],
        levels.map(level =>
          h.keyed('li')(level.id, [], [starterLevelRow(level, h)]),
        ),
      ),
    ],
  )
}
