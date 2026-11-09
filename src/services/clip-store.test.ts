import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { ClipStore } from './clip-store'

// The clip store's memory layer, which the history's tests stand on: a
// a file's URL, to play it from.

describe('ClipStore.layerMemory', () => {
  it.effect('gives a URL of a kept file, and none of a file not there', () =>
    Effect.gen(function* () {
      const store = yield* ClipStore
      yield* store.write('clips/a.mp3', Uint8Array.of(1, 2, 3))
      const maybeUrl = yield* Effect.scoped(
        store.url('clips/a.mp3', 'audio/mpeg'),
      )
      expect(Option.getOrThrow(maybeUrl).startsWith('blob:')).toBe(true)
      expect(yield* Effect.scoped(store.url('clips/none.mp3', ''))).toEqual(
        Option.none(),
      )
    }).pipe(Effect.provide(ClipStore.layerMemory(new Map()))),
  )

  it.effect('refuses a path that could climb out of its folder', () =>
    Effect.gen(function* () {
      const store = yield* ClipStore
      const error = yield* Effect.scoped(store.url('clips/../x', '')).pipe(
        Effect.flip,
      )
      expect(error.reason).toBe('No such file: clips/../x')
    }).pipe(Effect.provide(ClipStore.layerMemory(new Map()))),
  )
})
