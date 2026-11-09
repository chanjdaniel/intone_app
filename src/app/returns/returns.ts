import { Array, Option, Order, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { TakeEntry } from '../../services/history-records'
import { lineKeyOf, lineProgressOf, lineReturnOf } from '../history/history'
import type { LevelSource } from '../level/commands'
import { StarCount } from '../level/progress'
import { LineReturn } from './lineReturn'

// Lines that come back (report section 5, "Come back"): each line's
// next return is worked out from its blind takes kept on the device
// (../../score/returns.ts), never stored apart, as its stars are, so a
// re-score, a changed span, a restore or a deletion moves it with the
// takes. The home screen lists the lines due on the learner's day.

// A line due back, as its row on the home screen names it.
export const DueLine = Schema.Struct({
  clipId: Schema.String,
  lineId: Schema.String,
  title: Schema.String,
  // Whether the title is Japanese text, read as such.
  titleIsText: Schema.Boolean,
  levelName: Schema.String,
  // Its place in its level, counting from 1, to keep a level's lines in
  // order.
  number: Schema.Finite,
  stars: StarCount,
  lineReturn: LineReturn,
})
export type DueLine = typeof DueLine.Type

export const DuePage = defineTaggedUnion({
  NotLoaded: {},
  Loading: {},
  Ready: {
    today: Schema.String,
    // Due longest first, then by level and line.
    lines: Schema.Array(DueLine),
    // When the next line not yet due comes back, when one will.
    maybeNextOn: Schema.Option(Schema.String),
    // How many rows of the list are shown, a page at a time.
    shownRows: Schema.Finite,
  },
  Failed: { reason: Schema.String },
})
export type DuePage = typeof DuePage.Type

// The large-list frame's numbers (spec, "Frontend patterns applied").
export const dueFindFromRows = 12
export const dueRowsPerPage = 50

export const dueKeyOf = (line: Pick<DueLine, 'clipId' | 'lineId'>): string =>
  `${line.clipId}/${line.lineId}`

const dueOrder: Order.Order<DueLine> = Order.combine(
  Order.mapInput(Order.String, (line: DueLine) => line.lineReturn.dueOn),
  Order.combine(
    Order.mapInput(Order.String, (line: DueLine) => line.levelName),
    Order.mapInput(Order.Number, (line: DueLine) => line.number),
  ),
)

// The lines due on `today` among `lines`, each with its return, and the
// day the next of the rest comes back.
export const dueOn = (
  lines: ReadonlyArray<DueLine>,
  today: string,
): Readonly<{
  due: ReadonlyArray<DueLine>
  maybeNextOn: Option.Option<string>
}> => {
  const isDueToday = (line: DueLine): boolean => line.lineReturn.dueOn <= today
  const due = Array.filter(lines, isDueToday)
  const later = Array.filter(lines, line => !isDueToday(line))
  return {
    due: Array.sort(due, dueOrder),
    maybeNextOn: pipe(
      later,
      Array.map(line => line.lineReturn.dueOn),
      Array.sort(Order.String),
      Array.head,
    ),
  }
}

// The lines of `sources` due on `today`, from the takes kept on the
// device, and the day the next of the rest comes back. A line that
// cannot be copied here, its audio not on this device, is left out.
export const dueLinesOf = (
  entries: ReadonlyArray<TakeEntry>,
  sources: ReadonlyArray<Readonly<{ clipId: string; source: LevelSource }>>,
  today: string,
): ReturnType<typeof dueOn> => {
  const byLine = Array.groupBy(entries, lineKeyOf)
  const withReturns = sources.flatMap(({ clipId, source }) =>
    source.lines.flatMap((line, k): ReadonlyArray<DueLine> => {
      const takes = byLine[lineKeyOf({ clipId, lineId: line.lineId })] ?? []
      if (!line.copyable || !takes.some(take => take.mode === 'Blind')) {
        return []
      }
      return Option.match(
        lineReturnOf(takes, clipId, line.lineId, line.asKept),
        {
          onNone: () => [],
          onSome: lineReturn => [
            {
              clipId,
              lineId: line.lineId,
              title: line.title,
              titleIsText: line.titleIsText,
              levelName: source.name,
              number: k + 1,
              stars: lineProgressOf(takes, clipId, line.lineId, line.asKept)
                .stars,
              lineReturn,
            },
          ],
        },
      )
    }),
  )
  return dueOn(withReturns, today)
}

// A row's text, which the find words are looked for in.
export const dueLineText = (line: DueLine): string =>
  `${line.title} ${line.levelName}`

export const dueLinesFound = (
  lines: ReadonlyArray<DueLine>,
  words: string,
): ReadonlyArray<DueLine> => {
  const wanted = words.trim().toLocaleLowerCase()
  return wanted === ''
    ? lines
    : Array.filter(lines, line =>
        dueLineText(line).toLocaleLowerCase().includes(wanted),
      )
}
