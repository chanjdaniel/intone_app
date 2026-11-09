import { expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, tagline, update, view } from './main'

describe('home screen', () => {
  test('names the app in its one top-level heading and says what it is for', () => {
    scene(
      { update, view },
      given(init().model),
      expect(role('heading', { name: 'Intone', level: 1 })).toExist(),
      expect(text(tagline)).toExist(),
    )
  })
})
