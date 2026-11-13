import { Effect, Exit, Option, Scope } from 'effect'

import { assert, describe, it } from '@effect/vitest'

import { open } from './library'

// The library's own programs, embedded for real into a host element, as
// the app's Mount does.

const waitFor = (check: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    while (!check()) {
      yield* Effect.sleep('5 millis')
    }
  }).pipe(Effect.timeout('2 seconds'), Effect.orDie)

const heading = (host: Element): string =>
  host.querySelector('h1')?.textContent ?? ''

describe('open', () => {
  it.live('renders the index in the host until its scope closes', () =>
    Effect.gen(function* () {
      const host = document.body.appendChild(document.createElement('div'))
      const scope = yield* Scope.make()

      yield* open(host, Option.none()).pipe(Scope.provide(scope))
      yield* waitFor(() => heading(host) === 'Component library')

      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(host.childElementCount, 0)
      host.remove()
    }),
  )

  it.live('loads an entry file lazily and renders it', () =>
    Effect.gen(function* () {
      const host = document.body.appendChild(document.createElement('div'))
      const scope = yield* Scope.make()

      yield* open(host, Option.some('tokens')).pipe(Scope.provide(scope))
      yield* waitFor(() => heading(host) === 'Tokens')
      assert.include(host.textContent ?? '', 'Choices for you')

      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(host.childElementCount, 0)
      host.remove()
    }),
  )
})
