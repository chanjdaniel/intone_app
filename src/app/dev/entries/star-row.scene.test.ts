import { click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './star-row'

describe('the star row entry', () => {
  test('shows every count at both sizes, and scores each take pressed by the app’s rules', () => {
    scene(
      { update, view },
      given(init().model),
      expect(
        text('Read-out: 0 of 3 stars; best none yet; no take yet'),
      ).toExist(),
      expect(text('One star for 75% on a guided take.')).toExist(),
      click(role('button', { name: 'Guided, 70%' })),
      expect(text('This line has 0 of 3 stars.')).toExist(),
      click(role('button', { name: 'Guided, 80%' })),
      expect(text('A new personal best for this line, up from 70%.')).toExist(),
      expect(
        text('One star for this line: 75% or more on a guided take.'),
      ).toExist(),
      click(role('button', { name: 'Not compared' })),
      expect(
        text(
          'This line still has 1 of 3 stars: a take that could not be compared costs none.',
        ),
      ).toExist(),
      click(role('button', { name: 'Blind, 78%' })),
      expect(
        text('Three stars for this line: 75% or more on a blind take.'),
      ).toExist(),
      expect(text('This line has all three stars.')).toExist(),
      expect(
        text('Read-out: 3 of 3 stars; best 80%; last take Blind, 78%'),
      ).toExist(),
      click(role('button', { name: 'Start again' })),
      expect(
        text('Read-out: 0 of 3 stars; best none yet; no take yet'),
      ).toExist(),
    )
  })
})
