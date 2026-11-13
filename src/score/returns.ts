import { returnAfterMissDays, returnStepDays } from './constants'
import { type StarTake, type StarThresholds, starsOfTake } from './stars'

// A line's returns (report section 5, "Come back"): once a line has had a
// blind take, it comes back for another on a widening schedule, worked
// out from its blind takes alone, earliest first, so a guided take never
// counts as a return. A blind take made on or after the day the line is
// due is its return: one that reaches the clip's threshold brings the
// line back after the next step of `returnStepDays`, one that misses
// brings it back the next day and starts the steps again. A blind take
// made before the line is due moves the date only when it misses, so
// several in one sitting cannot skip the steps; one that could not be
// compared moves nothing, as it costs no star. A line due on a day stays
// due, however long after, with no penalty: the next return is reckoned
// from the day it is made.
//
// Days are the learner's own, `YYYY-MM-DD`, as each take keeps them.

export type ReturnTake = StarTake & Readonly<{ day: string }>

export type LineReturn = Readonly<{
  // The returns in a row that reached the threshold.
  streak: number
  // The day of the blind take that set the date.
  setOn: string
  dueOn: string
}>

const dayMs = 86_400_000

export const addDays = (day: string, days: number): string => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date) + days * dayMs)
    .toISOString()
    .slice(0, 10)
}

export const isDue = (lineReturn: LineReturn, today: string): boolean =>
  lineReturn.dueOn <= today

const stepDays = (streak: number): number =>
  returnStepDays[Math.min(streak, returnStepDays.length) - 1] ??
  returnAfterMissDays

const missedOn = (day: string): LineReturn => ({
  streak: 0,
  setOn: day,
  dueOn: addDays(day, returnAfterMissDays),
})

const reachedAfter = (streak: number, day: string): LineReturn => ({
  streak,
  setOn: day,
  dueOn: addDays(day, stepDays(streak)),
})

// The return after one more take of the line, from the one before it, or
// none before its first blind take.
export const returnAfter = (
  previous: LineReturn | null,
  take: ReturnTake,
  thresholds: StarThresholds,
): LineReturn | null => {
  if (take.mode !== 'Blind' || take.score._tag !== 'Scored') {
    return previous
  }
  const reached = starsOfTake(take, thresholds) === 3
  if (previous === null) {
    return reached ? reachedAfter(1, take.day) : missedOn(take.day)
  }
  if (!reached) {
    return missedOn(take.day)
  }
  return isDue(previous, take.day)
    ? reachedAfter(previous.streak + 1, take.day)
    : previous
}

// A line's return from its takes, earliest first.
export const returnOf = (
  takes: ReadonlyArray<ReturnTake>,
  thresholds: StarThresholds,
): LineReturn | null =>
  takes.reduce<LineReturn | null>(
    (previous, take) => returnAfter(previous, take, thresholds),
    null,
  )

// A line's return as it stands on `today`.
export const returnsOn = (
  takes: ReadonlyArray<ReturnTake>,
  today: string,
  thresholds: StarThresholds,
): (LineReturn & Readonly<{ due: boolean }>) | null => {
  const lineReturn = returnOf(takes, thresholds)
  return lineReturn === null
    ? null
    : { ...lineReturn, due: isDue(lineReturn, today) }
}
