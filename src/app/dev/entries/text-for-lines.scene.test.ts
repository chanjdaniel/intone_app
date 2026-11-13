import {
  Command,
  Mount,
  click,
  expect,
  given,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { init, update, view } from './text-for-lines'

describe('the text for the lines entry', () => {
  test('shows each state of an upload’s text, and the consent dialog following the model chosen', () => {
    scene(
      { update, view },
      given(init().model),
      expect(text('Read-out: Not written out; the dialog shut')).toExist(),
      click(role('button', { name: 'Downloading' })),
      expect(role('progressbar', { name: 'Text written out' })).toExist(),
      click(role('button', { name: 'Failed' })),
      expect(role('alert')).toHaveText(
        'The text was not written out. The text model stopped: out of memory',
      ),
      click(role('button', { name: 'Line typed' })),
      expect(role('textbox', { name: 'Line 3’s text' })).toHaveValue(
        '小さなお城',
      ),
      click(role('button', { name: 'Not written out' })),
      click(role('button', { name: 'Write out the text' })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Mount.resolve(
        Dialog.AcquireResources,
        Dialog.Message.SucceededAcquireResources(),
      ),
      expect(role('heading', { name: 'Download the text model?' })).toExist(),
      expect(
        text('Read-out: Not written out; the dialog open on whisper-base'),
      ).toExist(),
    )
  })
})
