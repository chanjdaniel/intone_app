import type { Html, HtmlBuilder } from 'foldkit/html'

import { starThresholds } from '../../score/stars'
import type { StarCount } from './progress'

// A line's stars, 0 to 3, drawn as three stars, those earned filled. To
// a screen reader the row is one image named by its count; stars just
// earned grow into place, only where the learner's system welcomes
// motion (`prefers-reduced-motion`).

const percent = (share: number): number => Math.round(100 * share)

export const starsText = (stars: StarCount): string =>
  stars === 1 ? '1 of 3 stars' : `${stars} of 3 stars`

// How each star is earned, by the clip's thresholds.
export const starRules = (): ReadonlyArray<string> => {
  const { reach, beat } = starThresholds()
  return [
    `One star for ${percent(reach)}% on a guided take.`,
    `Two for ${percent(beat)}% on a guided take.`,
    `Three for ${percent(reach)}% on a blind take, with the curves hidden.`,
  ]
}

const starPath =
  'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z'

const sizes = { small: 'size-5', large: 'size-8' } as const

export type StarRowOptions = Readonly<{
  size?: keyof typeof sizes
  // Stars above this many were just earned, and grow into place.
  earnedFrom?: StarCount
  // Drawn for the eye beside words that say the same.
  decorative?: boolean
}>

export const starRow = <ViewMessage>(
  stars: StarCount,
  h: HtmlBuilder<ViewMessage>,
  options: StarRowOptions = {},
): Html => {
  const size = sizes[options.size ?? 'small']
  const earnedFrom = options.earnedFrom ?? stars
  return h.span(
    [
      ...(options.decorative === true
        ? [h.AriaHidden(true)]
        : [h.Role('img'), h.AriaLabel(starsText(stars))]),
      h.DataAttribute('stars', String(stars)),
      h.Class('inline-flex shrink-0 items-center gap-0.5'),
    ],
    [1, 2, 3].map(place =>
      h.svg(
        [
          h.AriaHidden(true),
          h.ViewBox('0 0 24 24'),
          h.Class(
            `${size} ${place <= stars ? 'text-star' : 'text-native'} ${place <= stars && place > earnedFrom ? 'motion-safe:animate-star-earned' : ''}`,
          ),
        ],
        [
          h.path([
            h.D(starPath),
            h.Fill(place <= stars ? 'currentColor' : 'none'),
            h.Stroke('currentColor'),
            h.StrokeWidth('1.5'),
            h.StrokeLinejoin('round'),
          ]),
        ],
      ),
    ),
  )
}
