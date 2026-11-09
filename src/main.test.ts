import { Effect, Schema } from 'effect'

import { assert, describe, it } from '@effect/vitest'

import { Model, init } from './main'

describe('Model', () => {
  it.effect("decodes the app's initial model with its own schema", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(Model)(init().model)
      assert.deepStrictEqual(decoded, init().model)
    }),
  )

  it.effect('refuses a model for a screen the app does not have', () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(Model)({
        screen: 'Nowhere',
      }).pipe(Effect.result)
      assert.isTrue(result._tag === 'Failure')
    }),
  )
})
