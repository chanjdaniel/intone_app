import { Schema } from 'effect'

import { ListenSpeed, NativeCurve } from './line/native'
import { AppRoute } from './route'
import { Take } from './take/take'

export const Model = Schema.Struct({
  route: AppRoute,
  maybeDevLibraryFailure: Schema.Option(Schema.String),
  // The open line's native curve.
  native: NativeCurve,
  take: Take,
  // How many takes have started, so each has its own number.
  takesStarted: Schema.Finite,
  listenSpeed: ListenSpeed,
  // Why the last voice played did not, until another plays.
  maybePlaybackFailure: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type
