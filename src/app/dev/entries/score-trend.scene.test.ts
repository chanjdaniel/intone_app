import { all, expect, expectAll, given, role, scene } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './score-trend'

describe('the score trend entry', () => {
  test('draws the busiest line’s trend, its start and a single take, each described', () => {
    scene(
      { update, view },
      given(init().model),
      expectAll(all.role('img', { name: /^Your match over / })).toHaveCount(3),
      expect(
        role('img', { name: /^Your match over 1 take: first \d+%/ }),
      ).toExist(),
    )
  })
})
