import { Mount, click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { DrawCurvePair, Message, init, update, view } from './curve-view'

const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())

describe('the curve view entry', () => {
  test('draws each take over the line, each around its own median', () => {
    scene(
      { update, view },
      given(init().model),
      drawn,
      expect(
        text(
          'Read-out: low: the take 1.38 s around 89 Hz, the line 1.38 s around 160 Hz',
        ),
      ).toExist(),
      expect(
        role('img', {
          name: "The line's pitch curve, from the speaker's voice onset, in semitones around their typical pitch of 160 Hz.",
        }),
      ).toExist(),
      expect(
        role('img', {
          name: /^Your pitch curve, 1\.38 s from your voice onset, in semitones around your typical pitch of 89 Hz, over the line's/,
        }),
      ).toExist(),
      click(role('button', { name: 'Much slower' })),
      expect(text(/^Read-out: much-slower: the take 2\.\d\d s/)).toExist(),
    )
  })
})
