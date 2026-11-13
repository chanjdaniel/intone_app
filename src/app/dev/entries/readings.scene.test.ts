import {
  all,
  click,
  expect,
  first,
  given,
  label,
  role,
  scene,
  selector,
  submit,
  text,
  type,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './readings'

describe('the readings entry', () => {
  test('offers the readings with their size, shows them as ruby, and keeps an edit', () => {
    scene(
      { update, view },
      given(init().model),
      expect(
        text(/downloads the reading dictionary, 12 MB, from Intone itself/),
      ).toExist(),
      click(role('button', { name: 'Show readings' })),
      expect(first(all.selector('ruby'))).toHaveText('雨(あめ)'),
      click(role('button', { name: 'Line 2' })),
      click(role('button', { name: 'Edit a reading' })),
      expect(label('小')).toHaveAttr('value', 'しょう'),
      type(label('小'), 'こ'),
      type(label('狐'), 'ぎつね'),
      submit(role('form', { name: 'Edit the readings' })),
      expect(text('2 readings are your own, in colour.')).toExist(),
      expect(
        text("Read-out: line 2; shown; 2 of its readings the learner's own"),
      ).toExist(),
      click(role('button', { name: 'Failed' })),
      expect(selector('#readings-note')).toHaveText(
        'The readings did not load: The reading dictionary could not be downloaded. Hide them and show them again to try once more.',
      ),
    )
  })
})
