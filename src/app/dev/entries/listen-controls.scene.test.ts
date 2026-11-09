import { change, click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './listen-controls'

describe('the listen controls entry', () => {
  test('toggles each voice, picks a speed, and waits for a take', () => {
    scene(
      { update, view },
      given(init().model),
      expect(role('button', { name: 'Hear your take' })).toBeDisabled(),
      click(role('button', { name: 'Hear the line' })),
      expect(
        text('Read-out: playing the line, speed 1, no take yet'),
      ).toExist(),
      click(role('button', { name: 'Stop' })),
      expect(role('radiogroup', { name: 'Speed of the line' })).toExist(),
      expect(role('radio', { name: 'Normal speed' })).toBeChecked(),
      change(role('radio', { name: '0.5 times speed' }), '0.5'),
      expect(
        text('Read-out: nothing playing, speed 0.5, no take yet'),
      ).toExist(),
      click(role('button', { name: 'A take has finished' })),
      click(role('button', { name: 'Hear your take' })),
      expect(
        text('Read-out: playing the take, speed 0.5, a take to hear'),
      ).toExist(),
    )
  })
})
