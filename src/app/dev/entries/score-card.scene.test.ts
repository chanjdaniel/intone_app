import { Array } from 'effect'
import {
  Mount,
  click,
  expect,
  given,
  inside,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { provisionalText } from '../../take/scoreCard'
import { sampleScoreNames } from '../sampleScores'
import { DrawCurvePair, Message, init, update, view } from './score-card'

const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())

describe('the score card entry', () => {
  test('offers each state, scored by the app’s own score', () => {
    scene(
      { update, view },
      given(init().model),
      drawn,
      ...Array.map(sampleScoreNames, name =>
        expect(role('button', { name })).toExist(),
      ),
      expect(
        text(
          'Read-out: Provisional: 86% match to this clip (Pitch accent 0.771, Timing 1.000), provisional; no button pressed yet',
        ),
      ).toExist(),
      expect(text(provisionalText)).toExist(),
      expect(role('heading', { name: 'Where it differed most' })).toExist(),
    )
  })

  test('shows a settled scale, a missed accent and each take it could not compare', () => {
    scene(
      { update, view },
      given(init().model),
      drawn,
      click(role('button', { name: 'Scored' })),
      expect(text('86% match to this clip')).toExist(),
      expect(text(provisionalText)).toBeAbsent(),
      click(role('button', { name: 'Fall held' })),
      expect(text(/^Read-out: Fall held: 56% match to this clip/)).toExist(),
      click(role('button', { name: 'Too quiet' })),
      expect(
        role('heading', { name: 'Your take was too quiet to compare' }),
      ).toExist(),
      click(role('button', { name: 'Too little voiced' })),
      expect(
        role('heading', { name: 'Too little of your take could be compared' }),
      ).toExist(),
      click(role('button', { name: 'Length far off' })),
      expect(
        role('heading', {
          name: "Your take was too far from the line's length to compare",
        }),
      ).toExist(),
      inside(role('status'), expect(text(/%/)).toBeAbsent()),
    )
  })

  test('reads out the stretch asked for, its button stopping it', () => {
    scene(
      { update, view },
      given(init().model),
      drawn,
      click(role('button', { name: 'Hear your take there' })),
      expect(text(/pressed hear your take there$/)).toExist(),
      click(role('button', { name: 'Stop' })),
      expect(text(/pressed stop$/)).toExist(),
      expect(role('button', { name: 'Hear the line there' })).toExist(),
    )
  })
})
