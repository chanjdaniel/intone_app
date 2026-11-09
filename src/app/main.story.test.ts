import { Command, given, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { init, update } from './main'

describe('update', () => {
  test('the app starts on the home screen and asks for no work', () => {
    const start = init()

    expect(start.commands ?? []).toStrictEqual([])

    story(
      update,
      given(start.model),
      Command.expectNone(),
      model(current => {
        expect(current).toStrictEqual({ screen: 'Home' })
      }),
    )
  })
})
