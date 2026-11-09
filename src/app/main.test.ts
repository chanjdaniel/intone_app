import { Effect, Option, Schema } from 'effect'
import { fromString } from 'foldkit/url'

import { assert, describe, it } from '@effect/vitest'

import { Model, init } from './main'

const home = Option.getOrThrow(fromString('http://localhost/'))

describe('Model', () => {
  it.effect("decodes the app's initial model with its own schema", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(Model)(init(home).model)
      assert.deepStrictEqual(decoded, init(home).model)
    }),
  )

  it.effect('refuses a model on a route the app does not have', () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(Model)({
        route: { _tag: 'Nowhere' },
        maybeDevLibraryFailure: { _tag: 'None' },
      }).pipe(Effect.result)
      assert.isTrue(result._tag === 'Failure')
    }),
  )
})
