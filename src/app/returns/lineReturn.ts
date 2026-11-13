import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { returnAfter } from '../../score/returns'
import { starThresholds } from '../../score/stars'
import type { TakeMode } from '../../services/history-records'
import type { TakeScore } from '../take/take'

// A line's next return as the Model holds it (../../score/returns.ts),
// and what a take did to it.

export const LineReturn = Schema.Struct({
  // The returns in a row that reached the threshold.
  streak: Schema.Finite,
  // The learner's day of the blind take that set the date.
  setOn: Schema.String,
  dueOn: Schema.String,
})
export type LineReturn = typeof LineReturn.Type

// What a kept take says of its line's return: a compared blind take
// when the line comes back next, a guided take on a line due that it
// was not the return, any other nothing.
export const ReturnNote = defineTaggedUnion({
  Quiet: {},
  ComesBack: { on: Schema.String },
  StillDue: {},
})
export type ReturnNote = typeof ReturnNote.Type

export const isReturnDue = (
  maybeReturn: Option.Option<LineReturn>,
  today: string,
): boolean => Option.exists(maybeReturn, found => found.dueOn <= today)

// A kept take's effect on the line's return before it, made on `day`.
export const returnOutcomeOf = (
  before: Option.Option<LineReturn>,
  take: Readonly<{ mode: TakeMode; score: TakeScore; day: string }>,
): Readonly<{ note: ReturnNote; after: Option.Option<LineReturn> }> => {
  const after = Option.fromNullishOr(
    returnAfter(Option.getOrNull(before), take, starThresholds()),
  )
  const note =
    take.mode === 'Blind'
      ? Option.match(take.score._tag === 'Scored' ? after : Option.none(), {
          onNone: () => ReturnNote.Quiet(),
          onSome: found => ReturnNote.ComesBack({ on: found.dueOn }),
        })
      : isReturnDue(before, take.day)
        ? ReturnNote.StillDue()
        : ReturnNote.Quiet()
  return { note, after }
}
