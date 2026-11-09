import { Mount, click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { Message, PaintCurve, init, update, view } from './curve-view'

const painted = Mount.resolve(PaintCurve, Message.CompletedPaintCurve())

describe('the curve view entry', () => {
  test('draws each synthetic voice around its own median', () => {
    scene(
      { update, view },
      given(init().model),
      painted,
      expect(
        text('Read-out: middle: 1.38 s from the onset, median 160 Hz'),
      ).toExist(),
      click(role('button', { name: 'Low voice' })),
      expect(
        text('Read-out: low: 1.38 s from the onset, median 89 Hz'),
      ).toExist(),
      expect(
        role('img', {
          name: 'Your pitch curve, 1.38 s from your voice onset, in semitones around your typical pitch of 89 Hz.',
        }),
      ).toExist(),
      expect(
        text(
          'From your voice onset, 1.38 s. The middle line is your typical pitch, 89 Hz; the lines are 3 semitones apart.',
        ),
      ).toExist(),
    )
  })
})
