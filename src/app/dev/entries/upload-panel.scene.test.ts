import {
  changeFiles,
  click,
  expect,
  given,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './upload-panel'

describe('the upload panel entry', () => {
  test('shows each state of the cut, and a file chosen moves it on', () => {
    scene(
      { update, view },
      given(init().model),
      expect(text('Read-out: waiting for a file')).toExist(),
      click(role('button', { name: 'Finding their pitch' })),
      expect(role('progressbar')).toHaveAttr('aria-valuenow', '55'),
      expect(
        text('Read-out: reading.mp3: Finding each line’s pitch: 7 of 21.'),
      ).toExist(),
      click(role('button', { name: 'Stop' })),
      expect(text('Read-out: reading.mp3 stopped')).toExist(),
      click(role('button', { name: 'Over ten minutes' })),
      expect(role('alert')).toHaveText(
        'whole-episode.m4a could not be used. It is 23:41 long, and a clip can be at most 10 minutes. Cut it shorter first.',
      ),
      changeFiles(selector('input[type="file"]'), [
        new File(['x'], 'notes.txt', { type: 'text/plain' }),
      ]),
      expect(text('Read-out: notes.txt refused')).toExist(),
      changeFiles(selector('input[type="file"]'), [
        new File([new Uint8Array(4)], 'mine.wav', { type: 'audio/wav' }),
      ]),
      expect(
        role('heading', { name: 'Cutting mine.wav into lines' }),
      ).toExist(),
      expect(text(/^Choices for you/)).toExist(),
    )
  })
})
