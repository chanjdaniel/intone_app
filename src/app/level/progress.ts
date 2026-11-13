import { Option, Schema } from 'effect'

import { starThresholds, starsOfTake } from '../../score/stars'
import type { TakeMode } from '../../services/history-records'
import { ReturnNote } from '../returns/lineReturn'
import type { TakeScore } from '../take/take'

// A line's stars and personal best, as the Model knows them: worked out
// from the takes of it kept on the device (../../services/history-store.ts),
// each with its mode and score, by the rules in ../../score/stars.ts and
// the thresholds in ../../score/constants.ts. Only the takes of the line
// as it is now count, so a line whose span changed (ticket 14) starts its
// stars again, as its earlier takes copied other audio; a score made
// again by a later version, or a threshold tuned, moves them with it
// (../history/history.ts, `lineProgressOf`).

export const StarCount = Schema.Literals([0, 1, 2, 3])
export type StarCount = typeof StarCount.Type

export const LineProgress = Schema.Struct({
  stars: StarCount,
  // The best match of the line's takes, once one was scored.
  maybeBestMatch: Schema.Option(Schema.Finite),
})
export type LineProgress = typeof LineProgress.Type

export const noProgress: LineProgress = {
  stars: 0,
  maybeBestMatch: Option.none(),
}

// What a take did for its line: the stars before and after it, and
// whether it beat the line's best, which needs a best before it.
export const TakeOutcome = Schema.Struct({
  starsBefore: StarCount,
  starsAfter: StarCount,
  maybePreviousBest: Schema.Option(Schema.Finite),
  isPersonalBest: Schema.Boolean,
  // What it did to the line's next return (../returns/lineReturn.ts).
  returnNote: ReturnNote,
})
export type TakeOutcome = typeof TakeOutcome.Type

const percent = (share: number): number => Math.round(100 * share)

// A take's outcome against the line's progress before it, and the
// progress after. A take that could not be compared moves neither: it
// earns no star and costs none. A best is beaten at the whole percent
// the screen shows, so the screen never says a best was beaten by a
// match it shows as the same.
export const outcomeOf = (
  before: LineProgress,
  mode: TakeMode,
  score: TakeScore,
  returnNote: ReturnNote = ReturnNote.Quiet(),
): Readonly<{ outcome: TakeOutcome; after: LineProgress }> => {
  const earned = starsOfTake({ mode, score }, starThresholds())
  const stars = earned > before.stars ? earned : before.stars
  const maybeMatch =
    score._tag === 'Scored' ? Option.some(score.match) : Option.none()
  const isPersonalBest = Option.isSome(
    Option.filter(
      Option.zipWith(
        before.maybeBestMatch,
        maybeMatch,
        (best, match) => percent(match) > percent(best),
      ),
      beaten => beaten,
    ),
  )
  return {
    outcome: {
      starsBefore: before.stars,
      starsAfter: stars,
      maybePreviousBest: before.maybeBestMatch,
      isPersonalBest,
      returnNote,
    },
    after: {
      stars,
      maybeBestMatch: Option.match(maybeMatch, {
        onNone: () => before.maybeBestMatch,
        onSome: match =>
          Option.some(
            Option.match(before.maybeBestMatch, {
              onNone: () => match,
              onSome: best => Math.max(best, match),
            }),
          ),
      }),
    },
  }
}
