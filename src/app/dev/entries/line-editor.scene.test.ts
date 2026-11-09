import {
  Mount,
  click,
  expect,
  given,
  keydown,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { FollowPointer, Message, init, update, view } from './line-editor'

const followed = Mount.resolve(FollowPointer, Message.CompletedFollowPointer())

describe('the line editor entry', () => {
  test('shows the cut study’s clip around its first line, and changes it as the app plans', () => {
    scene(
      { update, view },
      given(init().model),
      followed,
      expect(text('Line 1 of 21')).toExist(),
      expect(role('slider', { name: 'Start of Line 1' })).toHaveAttr(
        'aria-valuetext',
        '0:00.39',
      ),
      keydown(role('slider', { name: 'End of Line 1' }), 'ArrowLeft'),
      expect(
        text(/^Read-out: 21 lines; line 1 selected, 0:00.39 to 0:02.94/),
      ).toExist(),
      click(role('button', { name: 'Line 2' })),
      expect(text('Line 2 of 21')).toExist(),
      click(role('button', { name: 'Merge with line 1' })),
      expect(text(/^Read-out: 20 lines; line 1 selected/)).toExist(),
      click(role('button', { name: 'Undo merging line 1' })),
      expect(text(/^Read-out: 21 lines/)).toExist(),
    )
  })

  test('the clip over music shows its lines’ marks and what they mean', () => {
    scene(
      { update, view },
      given(init().model),
      followed,
      click(role('button', { name: 'The same clip over music' })),
      expect(text(/Likely music under it\./)).toExist(),
    )
  })
})
