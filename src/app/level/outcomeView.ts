import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { starThresholds } from '../../score/stars'
import { dayText } from '../history/format'
import { ReturnNote } from '../returns/lineReturn'
import type { StarCount, TakeOutcome } from './progress'
import { starRow, starsText } from './starRow'

// Under a kept take's score: what it did for its line's stars and best,
// said in words, with the stars drawn beside them for the eye. It never
// counts a loss: a weaker take, or one that could not be compared, keeps
// the stars the line had.

const percent = (share: number): number => Math.round(100 * share)

const starNames = ['No stars', 'One star', 'Two stars', 'Three stars'] as const

// How the line's stars now were earned.
const earnedText = (stars: StarCount): string => {
  const { reach, beat } = starThresholds()
  return stars === 3
    ? `${percent(reach)}% or more on a blind take`
    : stars === 2
      ? `${percent(beat)}% or more on a guided take`
      : `${percent(reach)}% or more on a guided take`
}

// What the next star asks for.
const nextText = (stars: StarCount): string => {
  const { reach, beat } = starThresholds()
  return stars === 0
    ? `Reach ${percent(reach)}% on a guided take for a star.`
    : stars === 1
      ? `Reach ${percent(beat)}% on a guided take for two.`
      : stars === 2
        ? `Reach ${percent(reach)}% on a blind take, with the curves hidden, for three.`
        : 'This line has all three stars.'
}

// What a take did to the line's next return, in words.
export const returnNoteLines = (note: ReturnNote): ReadonlyArray<string> =>
  ReturnNote.match(note, {
    Quiet: () => [],
    ComesBack: ({ on }) => [
      `This line comes back for a blind take on ${dayText(on)}.`,
    ],
    StillDue: () => [
      'This line is due back: only a blind take counts as its return.',
    ],
  })

// The sentences an outcome is said in.
export const outcomeLines = (
  outcome: TakeOutcome,
  compared: boolean,
): ReadonlyArray<string> => {
  const stars = outcome.starsAfter
  const starLine =
    stars > outcome.starsBefore
      ? `${starNames[stars]} for this line: ${earnedText(stars)}.`
      : compared
        ? `This line has ${starsText(stars)}.`
        : `This line still has ${starsText(stars)}: a take that could not be compared costs none.`
  const bestLine = outcome.isPersonalBest
    ? Option.match(outcome.maybePreviousBest, {
        onNone: () => [],
        onSome: best => [
          `A new personal best for this line, up from ${percent(best)}%.`,
        ],
      })
    : []
  return [
    ...bestLine,
    starLine,
    ...(stars === 3 && stars === outcome.starsBefore ? [] : [nextText(stars)]),
    ...returnNoteLines(outcome.returnNote),
  ]
}

export const outcomeSummary = <ViewMessage>(
  outcome: TakeOutcome,
  compared: boolean,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [
      h.DataAttribute('take-outcome', ''),
      h.Class(
        'flex items-start gap-3 rounded-md border border-line bg-surface p-4',
      ),
    ],
    [
      starRow(outcome.starsAfter, h, {
        size: 'large',
        earnedFrom: outcome.starsBefore,
        decorative: true,
      }),
      h.div(
        [h.Class('flex flex-col gap-1')],
        outcomeLines(outcome, compared).map((line, k) =>
          h.p(
            [
              h.Class(
                k === 0 &&
                  (outcome.isPersonalBest ||
                    outcome.starsAfter > outcome.starsBefore)
                  ? 'text-base font-semibold text-ink'
                  : 'text-base text-muted',
              ),
            ],
            [line],
          ),
        ),
      ),
    ],
  )
