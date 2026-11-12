import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  label,
  role,
  scene,
  text,
  type,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { FocusRow, Message, init, update, view } from './clip-lines'

const rows = all.role('link', { name: /^Line \d+/ })

describe('the clip lines entry', () => {
  test('lists the cut study’s lines, and a ten-minute clip in the large-list frame', () => {
    scene(
      { update, view },
      given(init().model),
      expect(
        text('Read-out: romandourou.wav: 21 of 21 lines found, 21 shown'),
      ).toExist(),
      expectAll(rows).toHaveCount(21),
      click(role('button', { name: 'A ten-minute clip' })),
      expect(label('Find a line')).toExist(),
      click(role('button', { name: 'Show 50 more' })),
      // Focus goes to the first row just shown, as in the app.
      Command.expectExact(FocusRow({ index: 50 })),
      Command.resolve(FocusRow, Message.CompletedFocusRow()),
      expect(
        text('Read-out: ten-minutes.m4a: 200 of 200 lines found, 100 shown'),
      ).toExist(),
      type(label('Find a line'), '9:5'),
      expect(
        text('Read-out: ten-minutes.m4a: 4 of 200 lines found, 4 shown'),
      ).toExist(),
    )
  })
})
