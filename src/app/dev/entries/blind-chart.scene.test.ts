import { all, expect, expectAll, given, role, scene } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './blind-chart'

describe('the blind-take chart entry', () => {
  test('draws three lines’ blind takes, each summed up, a single take among them', () => {
    scene(
      { update, view },
      given(init().model),
      expectAll(
        all.role('img', { name: /^Your blind takes of this line: / }),
      ).toHaveCount(3),
      expect(
        role('img', {
          name: /^Your blind takes of this line: 1 take from .*: first \d+%, latest \d+%, best \d+%\./,
        }),
      ).toExist(),
    )
  })
})
