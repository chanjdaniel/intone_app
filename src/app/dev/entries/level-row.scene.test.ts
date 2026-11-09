import { expect, given, role, scene, text } from 'foldkit/scene'
import { describe, expect as expectValue, test } from 'vitest'

import { sampleLevelStars, sampleStarEntries } from '../sampleStars'
import { init, readOut, update, view } from './level-row'

describe('the level row entry', () => {
  test('shows each line with its stars, from the seeded takes', () => {
    expectValue({
      takes: sampleStarEntries.length,
      stars: sampleLevelStars.map(line => line.progress.stars).join(''),
    }).toStrictEqual({ takes: 57, stars: '103000320100001001003' })
    scene(
      { update, view },
      given(init().model),
      expect(text(`Read-out: ${readOut()}`)).toExist(),
      expect(
        role('link', { name: /^雨が好き, あめがすき, Line 1/ }),
      ).toHaveAttr('href', '/line/ame-ga-suki/1'),
      expect(role('img', { name: '0 of 3 stars' })).toExist(),
      expect(role('img', { name: '1 of 3 stars' })).toExist(),
      expect(role('img', { name: '2 of 3 stars' })).toExist(),
      expect(role('img', { name: '3 of 3 stars' })).toExist(),
    )
  })
})
