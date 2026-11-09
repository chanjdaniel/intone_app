import { Array, Option, Order, Schema, pipe } from 'effect'
import { Calendar } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'

import { SCORE_VERSION } from '../../score/constants'
import type { TakeEntry } from '../../services/history-records'
import { TakeCurve, TakeScore } from '../take/take'

// The history screens' part of the Model: what /history and a line's
// history show, summed up from the takes kept on the device
// (../../services/history-store.ts) when the screen opens. Only these
// sums enter the Model, and the three takes a line's page draws; the
// rest of every take stays on the device.

// One line the learner has practised, for /history's list.
export const LineSummary = Schema.Struct({
  clipId: Schema.String,
  lineId: Schema.String,
  lineText: Schema.String,
  takes: Schema.Finite,
  // The best and the latest match, of the takes that were scored.
  maybeBestMatch: Schema.Option(Schema.Finite),
  maybeLatestMatch: Schema.Option(Schema.Finite),
  latestAt: Schema.Finite,
  latestDay: Schema.String,
})
export type LineSummary = typeof LineSummary.Type

// How many takes the learner made on a day of theirs, `YYYY-MM-DD`.
export const DayCount = Schema.Struct({
  day: Schema.String,
  takes: Schema.Finite,
})
export type DayCount = typeof DayCount.Type

// Scoring older takes again, after the score's version has changed.
export const Rescoring = defineTaggedUnion({
  Idle: {},
  Running: {
    total: Schema.Finite,
    done: Schema.Finite,
    // Waiting for the batch being scored now.
    remainingIds: Schema.Array(Schema.String),
  },
  Done: { rescored: Schema.Finite },
  Failed: { reason: Schema.String },
})
export type Rescoring = typeof Rescoring.Type

export const HistoryPage = defineTaggedUnion({
  NotLoaded: {},
  Loading: {},
  Ready: {
    // Most recently practised first.
    lines: Schema.Array(LineSummary),
    // Earliest first.
    days: Schema.Array(DayCount),
    today: Calendar.CalendarDate,
    // The month the calendar shows: its first day.
    month: Calendar.CalendarDate,
    // How many rows of the list are shown, a page at a time.
    shownRows: Schema.Finite,
    // The takes scored by an earlier version of the score.
    outdatedIds: Schema.Array(Schema.String),
    unreadable: Schema.Finite,
    rescoring: Rescoring,
  },
  Failed: { reason: Schema.String },
})
export type HistoryPage = typeof HistoryPage.Type

// A take a line's page draws: its curve over the native it was scored
// against.
export const ShownTake = Schema.Struct({
  id: Schema.String,
  takenAt: Schema.Finite,
  day: Schema.String,
  score: TakeScore,
  curve: TakeCurve,
  native: TakeCurve,
})
export type ShownTake = typeof ShownTake.Type

// One take on a line's trend: its match, when it was scored.
export const TrendPoint = Schema.Struct({
  takenAt: Schema.Finite,
  maybeMatch: Schema.Option(Schema.Finite),
  version: Schema.Finite,
})
export type TrendPoint = typeof TrendPoint.Type

const lineFields = { clipId: Schema.String, lineId: Schema.String }

export const LineHistoryPage = defineTaggedUnion({
  NotLoaded: {},
  Loading: lineFields,
  Ready: {
    ...lineFields,
    lineText: Schema.String,
    // Earliest first.
    trend: Schema.Array(TrendPoint),
    first: ShownTake,
    maybeBest: Schema.Option(ShownTake),
    latest: ShownTake,
  },
  // No take of the line is kept.
  Empty: lineFields,
  Failed: { ...lineFields, reason: Schema.String },
})
export type LineHistoryPage = typeof LineHistoryPage.Type

// The list's page: the first 50 rows, then 50 more at a time.
export const rowsPerPage = 50
// The list offers a find field once it is longer than this.
export const findFieldFromRows = 12

const matchOf = (entry: TakeEntry): Option.Option<number> =>
  entry.score._tag === 'Scored' ? Option.some(entry.score.match) : Option.none()

const byTakenAt = Order.mapInput(
  Order.Number,
  (entry: TakeEntry) => entry.takenAt,
)

export const lineKeyOf = (line: Readonly<{ clipId: string; lineId: string }>) =>
  `${line.clipId}/${line.lineId}`

export const isOutdated = (entry: TakeEntry): boolean =>
  entry.score.version < SCORE_VERSION

// One line's summary, from its takes, earliest first.
const summaryOf = (
  takes: Array.NonEmptyReadonlyArray<TakeEntry>,
): LineSummary => {
  const latest = Array.lastNonEmpty(takes)
  const matches = Array.getSomes(Array.map(takes, matchOf))
  return {
    clipId: latest.clipId,
    lineId: latest.lineId,
    lineText: latest.lineText,
    takes: takes.length,
    maybeBestMatch: Array.isArrayNonEmpty(matches)
      ? Option.some(Math.max(...matches))
      : Option.none(),
    maybeLatestMatch: Option.fromNullishOr(matches.at(-1)),
    latestAt: latest.takenAt,
    latestDay: latest.day,
  }
}

// /history's sums of `entries`: the lines practised, most recent first,
// the days practised, earliest first, and the takes scored by an earlier
// version of the score.
export const summarise = (
  entries: ReadonlyArray<TakeEntry>,
): Readonly<{
  lines: ReadonlyArray<LineSummary>
  days: ReadonlyArray<DayCount>
  outdatedIds: ReadonlyArray<string>
}> => {
  const sorted = Array.sort(entries, byTakenAt)
  const lines = pipe(
    Object.values(Array.groupBy(sorted, lineKeyOf)),
    Array.map(summaryOf),
    Array.sort(
      Order.flip(
        Order.mapInput(Order.Number, (line: LineSummary) => line.latestAt),
      ),
    ),
  )
  const days = pipe(
    Object.entries(Array.groupBy(sorted, entry => entry.day)),
    Array.map(([day, takes]) => ({ day, takes: takes.length })),
    Array.sort(Order.mapInput(Order.String, (count: DayCount) => count.day)),
  )
  const outdatedIds = pipe(
    sorted,
    Array.filter(isOutdated),
    Array.map(entry => entry.id),
  )
  return { lines, days, outdatedIds }
}

// A line's takes, earliest first, and which of them its page draws: the
// first, the best scored (when one was), and the latest.
export const lineTakesOf = (
  entries: ReadonlyArray<TakeEntry>,
  clipId: string,
  lineId: string,
): Option.Option<
  Readonly<{
    takes: Array.NonEmptyReadonlyArray<TakeEntry>
    first: TakeEntry
    maybeBest: Option.Option<TakeEntry>
    latest: TakeEntry
  }>
> => {
  const takes = pipe(
    entries,
    Array.filter(entry => entry.clipId === clipId && entry.lineId === lineId),
    Array.sort(byTakenAt),
  )
  if (!Array.isArrayNonEmpty(takes)) {
    return Option.none()
  }
  const scored = Array.filter(takes, entry => entry.score._tag === 'Scored')
  // NOTE: the best is the latest of the takes with the highest match, so
  // a tie goes to the newer take.
  const maybeBest = Array.isArrayNonEmpty(scored)
    ? Option.some(
        scored.reduce((best, entry) =>
          Option.getOrElse(matchOf(entry), () => 0) >=
          Option.getOrElse(matchOf(best), () => 0)
            ? entry
            : best,
        ),
      )
    : Option.none()
  return Option.some({
    takes,
    first: Array.headNonEmpty(takes),
    maybeBest,
    latest: Array.lastNonEmpty(takes),
  })
}

export const trendOf = (
  takes: ReadonlyArray<TakeEntry>,
): ReadonlyArray<TrendPoint> =>
  Array.map(takes, entry => ({
    takenAt: entry.takenAt,
    maybeMatch: matchOf(entry),
    version: entry.score.version,
  }))
