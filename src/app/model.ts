import { Schema } from 'effect'

import { AppRoute } from './route'
import { Take } from './take/take'

export const Model = Schema.Struct({
  route: AppRoute,
  maybeDevLibraryFailure: Schema.Option(Schema.String),
  take: Take,
  // How many takes have started, so each has its own number.
  takesStarted: Schema.Finite,
})
export type Model = typeof Model.Type
